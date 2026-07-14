import assert from 'node:assert/strict'
import { prepareProviderMessages } from '../electron/multimodal.mjs'

const imageDataUrl = `data:image/png;base64,${Buffer.from('image').toString('base64')}`
const audioDataUrl = `data:audio/mpeg;base64,${Buffer.from('audio').toString('base64')}`
const messages = [
  { role: 'system', content: 'system' },
  {
    role: 'user',
    content: '请分析',
    attachments: [
      { id: 'image', name: 'sample.png', kind: 'image', mimeType: 'image/png', size: 5, dataUrl: imageDataUrl },
      { id: 'audio', name: 'sample.mp3', kind: 'audio', mimeType: 'audio/mpeg', size: 5, dataUrl: audioDataUrl }
    ]
  }
]

const openAI = prepareProviderMessages('openai-compatible', messages)
assert.equal(openAI[1].content[0].type, 'text')
assert.equal(openAI[1].content[1].type, 'image_url')
assert.equal(openAI[1].content[2].type, 'input_audio')
assert.equal(openAI[1].content[2].input_audio.format, 'mp3')

const gemini = prepareProviderMessages('gemini', messages)
assert.equal(gemini[1].role, 'user')
assert.equal(gemini[1].parts[1].inlineData.mimeType, 'image/png')
assert.equal(gemini[1].parts[2].inlineData.mimeType, 'audio/mpeg')

const imageOnly = [messages[0], { ...messages[1], attachments: [messages[1].attachments[0]] }]
const anthropic = prepareProviderMessages('anthropic', imageOnly)
assert.equal(anthropic[1].content[0].type, 'image')
assert.equal(anthropic[1].content[1].type, 'text')

const ollama = prepareProviderMessages('ollama', imageOnly)
assert.deepEqual(ollama[1].images, [Buffer.from('image').toString('base64')])

assert.throws(() => prepareProviderMessages('anthropic', messages), /暂不支持音频附件/)
assert.throws(() => prepareProviderMessages('ollama', messages), /暂不支持.*音频/)
assert.throws(() => prepareProviderMessages('openai-compatible', [{ role: 'user', content: '', attachments: [{ ...messages[1].attachments[0], dataUrl: 'invalid' }] }]), /数据无效/)

console.log('MULTIMODAL_CONTRACT_OK')
