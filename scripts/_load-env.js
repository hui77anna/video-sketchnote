// 自动加载 ~/.video-sketchnote-env.sh 到 process.env
// 适配 OpenClaw / Cursor / 其他 agent 在每条命令开 fresh shell 的场景
// 用法: require('./_load-env') 在脚本最顶部
const fs = require('fs')
const os = require('os')
const path = require('path')

function loadEnvFile() {
  const envFile = path.join(os.homedir(), '.video-sketchnote-env.sh')
  if (!fs.existsSync(envFile)) return
  const content = fs.readFileSync(envFile, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*export\s+([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2]
    }
  }
}

loadEnvFile()
