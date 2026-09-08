import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderModelBadge } from './ProviderModelBadge'

describe('ProviderModelBadge', () => {
  it('renders a quiet provider/model annotation with a full accessible label', () => {
    const html = renderToStaticMarkup(<ProviderModelBadge provider="Codex" model="GPT-5.1 Codex Mini" />)
    expect(html).toContain('Codex')
    expect(html).toContain('GPT-5.1 Codex Mini')
    expect(html).toContain('title="Codex · GPT-5.1 Codex Mini"')
    expect(html).toContain('border-\[var\(--color-edge\)\]')
  })
})
