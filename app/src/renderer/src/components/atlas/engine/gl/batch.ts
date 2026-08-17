/** A triangle batcher over WebGL2.
 *
 * The plate is a few thousand small triangles in a handful of colours,
 * redrawn on a camera that moves. That is not a case for one draw call per
 * mark: it is a case for one buffer, filled per frame, uploaded once, drawn
 * once. So this keeps a single growable Float32Array of `[x, y, r, g, b, a]`
 * and hands the whole thing to the GPU at `flush()`.
 *
 * The world transform lives in a uniform rather than in the vertices, so
 * panning and zooming never touch the buffer — only the two floats of the
 * camera change, and a plate that is merely being dragged re-uploads
 * nothing.
 *
 * Blending is straight alpha over a pre-cleared background, matching what
 * Canvas2D does with `globalAlpha`: the plate fills its own void colour
 * first rather than clearing to transparent, so the two painters composite
 * the same way against the window behind them.
 *
 * Ported verbatim from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/gl/batch.ts) — pure WebGL2
 * plumbing, no domain concept anywhere in it. */

const FLOATS_PER_VERTEX = 6

/** ~24MB of vertex data, far above any honest frame on this plate and far
 * below what makes a driver reset the context. */
const MAX_VERTICES = 1_000_000

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_zoom;
out vec4 v_color;
void main() {
  vec2 world = a_pos * u_zoom + u_translate;
  vec2 clip = (world / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`

const FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`

export class TriangleBatch {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly buffer: WebGLBuffer
  private readonly uResolution: WebGLUniformLocation | null
  private readonly uTranslate: WebGLUniformLocation | null
  private readonly uZoom: WebGLUniformLocation | null

  private data: Float32Array
  private count = 0
  private uploaded = 0
  private warnedFull = false

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = link(gl, VERT, FRAG)
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution')
    this.uTranslate = gl.getUniformLocation(this.program, 'u_translate')
    this.uZoom = gl.getUniformLocation(this.program, 'u_zoom')

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('WebGL2 buffers unavailable')
    this.vao = vao
    this.buffer = buffer

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const stride = FLOATS_PER_VERTEX * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8)
    gl.bindVertexArray(null)

    this.data = new Float32Array(4096 * FLOATS_PER_VERTEX)
  }

  begin(): void {
    this.count = 0
  }

  /** Append triangles, flat `[x,y,…]`, all one colour, offset by `dx, dy`.
   *
   * The offset belongs here rather than at the call sites because it is
   * what lets a shape be baked once and drawn in many places. It defaults
   * to nothing, which is what every caller drawing geometry already in
   * world coordinates wants.
   *
   * Silently stops accepting geometry past the ceiling. A frame that wants
   * more than this has a bug in it, and the honest failure is a plate
   * missing its last few marks — not a buffer that grows until the driver
   * takes the context away and the whole surface goes blank. */
  push(tris: readonly number[], rgb: readonly [number, number, number], alpha: number, dx = 0, dy = 0): void {
    if (alpha <= 0.001 || tris.length < 6) return
    if (this.count >= MAX_VERTICES) {
      if (!this.warnedFull) {
        this.warnedFull = true
        console.warn(`atlas: frame hit the ${MAX_VERTICES} vertex ceiling; dropping the rest`)
      }
      return
    }
    const vertices = tris.length / 2
    this.reserve(vertices)
    let o = this.count * FLOATS_PER_VERTEX
    for (let i = 0; i < tris.length; i += 2) {
      this.data[o] = tris[i] + dx
      this.data[o + 1] = tris[i + 1] + dy
      this.data[o + 2] = rgb[0]
      this.data[o + 3] = rgb[1]
      this.data[o + 4] = rgb[2]
      this.data[o + 5] = alpha
      o += FLOATS_PER_VERTEX
    }
    this.count += vertices
  }

  /** Append triangles whose alpha varies per vertex.
   *
   * The batch already stores a colour per vertex; only the API assumed one
   * alpha for the whole push. Lifting that is what makes a real glow
   * possible: a ring of triangles bright at the inner edge and transparent
   * at the outer one falls off smoothly, where concentric flat-alpha discs
   * band. */
  pushVarying(
    tris: readonly number[],
    rgb: readonly [number, number, number],
    alphas: readonly number[],
    dx = 0,
    dy = 0,
  ): void {
    if (tris.length < 6) return
    const vertices = tris.length / 2
    if (vertices !== alphas.length) return
    if (this.count >= MAX_VERTICES) return
    this.reserve(vertices)
    let o = this.count * FLOATS_PER_VERTEX
    for (let i = 0; i < vertices; i++) {
      this.data[o] = tris[i * 2] + dx
      this.data[o + 1] = tris[i * 2 + 1] + dy
      this.data[o + 2] = rgb[0]
      this.data[o + 3] = rgb[1]
      this.data[o + 4] = rgb[2]
      this.data[o + 5] = alphas[i]
      o += FLOATS_PER_VERTEX
    }
    this.count += vertices
  }

  private reserve(vertices: number): void {
    const needed = (this.count + vertices) * FLOATS_PER_VERTEX
    if (needed <= this.data.length) return
    let size = this.data.length * 2
    while (size < needed) size *= 2
    const next = new Float32Array(size)
    next.set(this.data.subarray(0, this.count * FLOATS_PER_VERTEX))
    this.data = next
  }

  /** Upload and draw everything pushed since `begin()`. */
  flush(width: number, height: number, tx: number, ty: number, zoom: number): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)

    // Upload only what this frame uses. The array is grown by doubling, so
    // handing the whole of it to the driver meant uploading up to twice the
    // geometry actually being drawn — and the moment that allocation is
    // large, a per-frame upload of it is exactly the pressure that costs a
    // context.
    const floats = this.count * FLOATS_PER_VERTEX
    if (this.data.length > this.uploaded) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
      this.uploaded = this.data.length
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, floats)

    gl.uniform2f(this.uResolution, width, height)
    gl.uniform2f(this.uTranslate, tx, ty)
    gl.uniform1f(this.uZoom, zoom)
    gl.drawArrays(gl.TRIANGLES, 0, this.count)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}

function link(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL2 program unavailable')
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc)
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  // Shaders are deleted whether or not the link took: they are reference
  // counted, and the program keeps what it needs.
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`plate shader link failed: ${log ?? 'no log'}`)
  }
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL2 shader unavailable')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`plate shader compile failed: ${log ?? 'no log'}`)
  }
  return shader
}
