const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')

// 模拟 main 进程的提示词加载逻辑
function loadPrompt(name: any) {
  const promptPath = path.join(process.cwd(), 'src/main/prompts', `${name}.txt`)
  if (!fs.existsSync(promptPath)) {
    throw new Error(`提示词文件不存在: ${promptPath}`)
  }
  return fs.readFileSync(promptPath, 'utf8')
}

async function testVision(imagePath: any, apiKey: any, endpoint: any, modelName: any) {
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  if (!fs.existsSync(imagePath)) {
    console.error(`错误: 图片文件不存在: ${imagePath}`)
    process.exit(1)
  }
  const base64Image = fs.readFileSync(imagePath).toString('base64')

  const visionPrompt = loadPrompt('vision')
  console.log(`--- SYSTEM PROMPT (Lines: ${visionPrompt.split('\n').length}) ---`)
  console.log(visionPrompt.substring(0, 500) + '...')
  console.log('----------------------')

  console.log(`正在请求 LLM (${modelName})...`)
  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: visionPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            {
              type: 'text',
              text: '请根据提供的截图，识别当前应用、操作内容，并严格按如下 JSON schema 返回结果：\n{"intent": string, "tags": string[], "is_productive": boolean, "category": "编程|会议|沟通|设计|文档|调研|闲暇|其他", "secondary_activity": string}'
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })

    console.log('--- AI RAW RESPONSE ---')
    console.log(response.choices[0].message.content)
    console.log('------------------------')
    console.log('Token Usage:', response.usage)
  } catch (error: any) {
    console.error('API 调用失败:', error.message)
    if (error.response) {
      console.error('Response data:', error.response.data)
    }
  }
}

const args = process.argv.slice(2)
if (args.length < 4) {
  console.log('用法: node scripts/test-vision.ts <image_path> <api_key> <endpoint> <model_name>')
} else {
  testVision(args[0], args[1], args[2], args[3]).catch(err => console.error(err))
}
