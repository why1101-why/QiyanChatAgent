import { createServer } from 'node:http'

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-embedding' }] }))
    return
  }
  if (request.method === 'POST' && request.url === '/v1/embeddings') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0.5, 0.25] }] }))
    return
  }
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      const content = payload.messages?.find(message => message.role === 'user')?.content
      let reply = '你好'
      if (Array.isArray(content)) {
        const types = content.map(item => item.type)
        if (!types.includes('image_url') || !types.includes('input_audio')) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: { message: 'multimodal payload missing image or audio' } }))
          return
        }
        console.log('MULTIMODAL_REQUEST_OK')
        reply = '附件识别成功'
      }
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}`)
    })
    return
  }
  response.statusCode = 404
  response.end('not found')
})

server.listen(17843, '127.0.0.1', () => console.log('MOCK_READY=17843'))
