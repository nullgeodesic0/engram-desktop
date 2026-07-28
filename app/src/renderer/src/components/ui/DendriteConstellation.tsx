/** The sidebar's dendrite constellation footer — the icon's neuron, quieted:
 * an axon entering from the edge, a tapered-branch soma reaching up into a
 * small concept graph (one consolidated cream node). Ambiently ALIVE: nodes
 * flash inward at staggered delays, the soma integrates, an impulse travels
 * the axon and the amber spark flares as it arrives — see index.css's
 * sb-fire-* doctrine comment (7s cycle, reduced-motion covered). Pure
 * imagery: aria-hidden, pointer-events-none, behind the nav (z-0 vs z-10).
 * Moved verbatim out of App.tsx (was inline at L352-434) — same markup,
 * same ids, same className hooks into index.css's sb-fire-* animations.
 * Callers are responsible for hiding it while the sidebar is collapsed (at
 * rail width it would just read as noise) — see App.tsx's `!collapsed &&`. */
export function DendriteConstellation() {
  return (
    // opacity-70: dimmed since the rail went translucent — the NeuralField's
    // own luminous nodes now read through this footer's patch of glass, and
    // two constellations at full strength in the same corner fight each
    // other; the etched one yields a step so the ambient weather stays behind
    // it. (The inner <g> keeps its long-standing 0.55 — this is a second,
    // deliberate dimming for the glass rail, not a replacement.)
    <svg viewBox="0 0 192 240" className="pointer-events-none select-none absolute bottom-0 inset-x-0 z-0 opacity-70" aria-hidden="true">
      <defs>
        <radialGradient id="sb-halo-cream" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-paper)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--color-ink-paper)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-halo-lav" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-lavender)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--color-ink-lavender)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-halo-amber" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-warm)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--color-ink-warm)" stopOpacity="0" />
        </radialGradient>
        {/* Brighter variants for the firing flashes only — the static
            resting halos above stay soft. */}
        <radialGradient id="sb-halo-fire" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-lavender)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--color-ink-lavender)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-halo-fire-cream" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-paper)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--color-ink-paper)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-halo-fire-amber" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ink-warm)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--color-ink-warm)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g opacity="0.55">
        <g stroke="var(--color-ink-lavender)" strokeOpacity="0.5" strokeWidth="1" fill="none">
          <path d="M58 124 L50 106 M104 128 L112 104 M36 152 L22 138 M50 106 L78 88 M112 104 L146 92 M78 88 L120 62 M146 92 L170 120 M120 62 L96 44 M50 106 L44 84 M130 154 L162 168 M118 214 L134 228 M46 122 L38 116 M110 137 L122 124" />
        </g>
        <circle cx="78" cy="88" r="13" fill="url(#sb-halo-cream)" />
        <circle cx="146" cy="92" r="11" fill="url(#sb-halo-fire)" className="sb-fire-halo" />
        <circle cx="120" cy="62" r="10" fill="url(#sb-halo-fire)" className="sb-fire-halo" style={{ animationDelay: '0.45s' }} />
        <circle cx="50" cy="106" r="11" fill="url(#sb-halo-fire)" className="sb-fire-halo" style={{ animationDelay: '0.9s' }} />
        <circle cx="78" cy="88" r="13" fill="url(#sb-halo-fire-cream)" className="sb-fire-halo" style={{ animationDelay: '1.35s' }} />
        <circle cx="22" cy="138" r="10" fill="url(#sb-halo-fire)" className="sb-fire-halo" style={{ animationDelay: '1.8s' }} />
        <circle cx="84" cy="176" r="16" fill="url(#sb-halo-fire)" className="sb-fire-halo" style={{ animationDelay: '2.1s' }} />
        <g fill="var(--color-ink-lavender)">
          <path d="M 82.2 167.3 L 81.2 164.9 L 80.3 162.5 L 79.3 160.2 L 78.3 158.0 L 77.2 155.9 L 76.2 153.8 L 75.2 151.7 L 74.1 149.7 L 73.0 147.7 L 71.9 145.8 L 70.8 143.9 L 69.7 142.1 L 68.6 140.2 L 67.5 138.4 L 66.3 136.6 L 65.2 134.8 L 64.1 133.0 L 62.9 131.1 L 61.8 129.3 L 60.7 127.5 L 59.5 125.6 L 58.4 123.8 L 57.6 124.2 L 58.6 126.2 L 59.7 128.1 L 60.7 130.0 L 61.8 131.8 L 62.8 133.7 L 63.8 135.6 L 64.8 137.5 L 65.8 139.3 L 66.8 141.2 L 67.7 143.1 L 68.7 145.1 L 69.6 147.0 L 70.5 149.0 L 71.4 151.0 L 72.3 153.1 L 73.2 155.1 L 74.0 157.3 L 74.8 159.4 L 75.6 161.7 L 76.4 164.0 L 77.1 166.3 L 77.8 168.7 Z" />
          <path d="M 94.2 168.8 L 94.9 166.6 L 95.5 164.5 L 96.2 162.5 L 96.8 160.5 L 97.4 158.5 L 98.0 156.6 L 98.6 154.8 L 99.1 152.9 L 99.7 151.1 L 100.2 149.4 L 100.6 147.6 L 101.1 145.9 L 101.5 144.2 L 101.9 142.4 L 102.3 140.7 L 102.7 139.0 L 103.1 137.2 L 103.4 135.4 L 103.7 133.6 L 104.0 131.8 L 104.2 130.0 L 104.5 128.1 L 103.5 127.9 L 103.2 129.8 L 102.8 131.6 L 102.5 133.4 L 102.0 135.2 L 101.6 136.9 L 101.1 138.6 L 100.6 140.2 L 100.1 141.9 L 99.5 143.6 L 99.0 145.2 L 98.4 146.9 L 97.7 148.6 L 97.0 150.2 L 96.4 152.0 L 95.6 153.7 L 94.9 155.5 L 94.1 157.3 L 93.3 159.2 L 92.5 161.1 L 91.6 163.0 L 90.8 165.1 L 89.8 167.2 Z" />
          <path d="M 76.8 170.1 L 74.9 169.3 L 73.0 168.6 L 71.1 168.0 L 69.2 167.3 L 67.3 166.6 L 65.5 166.0 L 63.7 165.3 L 61.9 164.6 L 60.1 163.9 L 58.3 163.2 L 56.5 162.5 L 54.7 161.7 L 52.9 160.9 L 51.1 160.1 L 49.3 159.2 L 47.5 158.3 L 45.6 157.4 L 43.8 156.3 L 41.9 155.3 L 40.1 154.1 L 38.2 152.9 L 36.3 151.6 L 35.7 152.4 L 37.6 153.8 L 39.5 155.1 L 41.3 156.3 L 43.1 157.5 L 44.9 158.6 L 46.7 159.7 L 48.5 160.7 L 50.3 161.7 L 52.0 162.7 L 53.8 163.6 L 55.5 164.5 L 57.3 165.4 L 59.0 166.3 L 60.8 167.1 L 62.6 168.0 L 64.3 168.8 L 66.1 169.6 L 67.9 170.5 L 69.7 171.3 L 71.5 172.2 L 73.3 173.0 L 75.2 173.9 Z" />
          <path d="M 92.6 174.0 L 94.5 173.4 L 96.4 172.7 L 98.2 172.0 L 100.0 171.2 L 101.8 170.5 L 103.6 169.7 L 105.4 168.9 L 107.1 168.1 L 108.8 167.3 L 110.5 166.4 L 112.2 165.5 L 113.9 164.6 L 115.6 163.7 L 117.2 162.7 L 118.9 161.8 L 120.5 160.8 L 122.2 159.8 L 123.8 158.7 L 125.4 157.7 L 127.0 156.6 L 128.6 155.5 L 130.3 154.4 L 129.7 153.6 L 128.1 154.6 L 126.4 155.7 L 124.8 156.6 L 123.1 157.6 L 121.4 158.5 L 119.8 159.4 L 118.1 160.3 L 116.4 161.1 L 114.7 161.9 L 113.0 162.7 L 111.3 163.5 L 109.5 164.2 L 107.8 164.9 L 106.0 165.6 L 104.3 166.2 L 102.5 166.8 L 100.7 167.4 L 98.9 168.0 L 97.0 168.5 L 95.2 169.0 L 93.3 169.5 L 91.4 170.0 Z" />
          <path d="M 88.5 185.5 L 89.9 186.8 L 91.3 188.0 L 92.7 189.3 L 94.1 190.5 L 95.4 191.7 L 96.7 192.9 L 98.0 194.1 L 99.3 195.4 L 100.6 196.6 L 101.9 197.8 L 103.2 199.0 L 104.5 200.3 L 105.7 201.5 L 107.0 202.8 L 108.3 204.1 L 109.6 205.5 L 110.9 206.8 L 112.2 208.3 L 113.6 209.7 L 114.9 211.2 L 116.2 212.7 L 117.6 214.3 L 118.4 213.7 L 117.0 212.0 L 115.7 210.5 L 114.5 208.9 L 113.2 207.4 L 112.0 205.9 L 110.8 204.4 L 109.6 203.0 L 108.4 201.6 L 107.2 200.2 L 106.0 198.8 L 104.8 197.5 L 103.6 196.1 L 102.5 194.8 L 101.3 193.5 L 100.1 192.1 L 98.9 190.8 L 97.7 189.4 L 96.5 188.1 L 95.3 186.7 L 94.0 185.3 L 92.8 183.9 L 91.5 182.5 Z" />
          <path d="M 66.8 137.2 L 65.9 136.4 L 65.1 135.7 L 64.2 134.9 L 63.3 134.2 L 62.5 133.5 L 61.6 132.8 L 60.7 132.2 L 59.8 131.5 L 58.9 130.8 L 58.0 130.2 L 57.1 129.5 L 56.2 128.9 L 55.3 128.2 L 54.3 127.5 L 53.4 126.9 L 52.4 126.2 L 51.4 125.5 L 50.4 124.8 L 49.4 124.1 L 48.3 123.3 L 47.3 122.6 L 46.2 121.8 L 45.8 122.2 L 46.9 123.1 L 47.9 123.9 L 49.0 124.6 L 50.0 125.4 L 50.9 126.2 L 51.9 126.9 L 52.8 127.6 L 53.7 128.3 L 54.6 129.1 L 55.5 129.8 L 56.4 130.5 L 57.2 131.2 L 58.1 131.9 L 58.9 132.6 L 59.7 133.3 L 60.5 134.1 L 61.3 134.8 L 62.1 135.6 L 62.9 136.4 L 63.7 137.1 L 64.4 137.9 L 65.2 138.8 Z" />
          <path d="M 97.7 148.7 L 98.2 148.1 L 98.7 147.6 L 99.2 147.1 L 99.8 146.5 L 100.3 146.0 L 100.8 145.5 L 101.3 145.0 L 101.9 144.5 L 102.4 143.9 L 102.9 143.4 L 103.5 142.9 L 104.0 142.4 L 104.6 141.9 L 105.2 141.4 L 105.8 140.9 L 106.4 140.4 L 107.0 139.9 L 107.6 139.4 L 108.2 138.9 L 108.9 138.3 L 109.5 137.8 L 110.2 137.2 L 109.8 136.8 L 109.1 137.3 L 108.5 137.8 L 107.8 138.3 L 107.1 138.8 L 106.5 139.3 L 105.8 139.8 L 105.2 140.2 L 104.6 140.7 L 104.0 141.1 L 103.4 141.6 L 102.8 142.1 L 102.2 142.5 L 101.6 143.0 L 101.0 143.4 L 100.4 143.9 L 99.8 144.3 L 99.2 144.8 L 98.6 145.3 L 98.0 145.8 L 97.5 146.3 L 96.9 146.8 L 96.3 147.3 Z" />
        </g>
        <path d="M-8 232 C40 224 58 206 76 186" stroke="var(--color-ink-lavender)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <g className="sb-fire-soma">
          <circle cx="84" cy="176" r="9" fill="var(--color-nocturne-lo)" stroke="var(--color-ink-lavender)" strokeWidth="2" />
          <circle cx="84" cy="176" r="2.5" fill="var(--color-ink-lavender)" fillOpacity="0.8" />
        </g>
        <g fill="var(--color-ink-lavender)">
          <circle cx="146" cy="92" r="3.5" className="sb-fire-node" />
          <circle cx="120" cy="62" r="2.5" className="sb-fire-node" style={{ animationDelay: '0.45s' }} />
          <circle cx="50" cy="106" r="3.5" className="sb-fire-node" style={{ animationDelay: '0.9s' }} />
          <circle cx="22" cy="138" r="3" className="sb-fire-node" style={{ animationDelay: '1.8s' }} />
          <circle cx="170" cy="120" r="2.5" />
          <circle cx="96" cy="44" r="2.5" />
          <circle cx="44" cy="84" r="2.5" />
          <circle cx="162" cy="168" r="3" />
          <circle cx="134" cy="228" r="3" />
          <circle cx="38" cy="116" r="2.5" />
          <circle cx="122" cy="124" r="2.5" />
        </g>
        <circle cx="78" cy="88" r="4" fill="var(--color-ink-paper)" className="sb-fire-node" style={{ animationDelay: '1.35s' }} />
        <circle r="3.2" fill="var(--color-ink-lavender)" className="sb-axon-impulse" />
        <circle cx="34" cy="222" r="11" fill="url(#sb-halo-amber)" />
        <circle cx="34" cy="222" r="14" fill="url(#sb-halo-fire-amber)" className="sb-fire-spark-halo" />
        <g transform="rotate(45 34 222)">
          <g className="sb-fire-spark">
            <g stroke="var(--color-ink-warm)" strokeWidth="1.6" strokeLinecap="round" fill="none">
              <path d="M27.5 222 L31 222 M37 222 L40.5 222 M34 215.5 L34 219 M34 225 L34 228.5" />
            </g>
            <circle cx="34" cy="222" r="1.5" fill="var(--color-ink-warm)" />
          </g>
        </g>
      </g>
    </svg>
  )
}
