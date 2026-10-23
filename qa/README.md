# 可选：真实 DSH 浏览器集成测试

此测试使用真实 DSH 0.2.1-rc.2 前端、模型服务、会话与编辑器。模型响应来自本地固定测试提供者，不需要 API Key，不代表真实模型效果。所有配置和会话写在当前项目的 `e2e-home` 中。

在源码根目录准备独立运行时：

```sh
npm install --prefix qa-runtime --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.2 playwright
npx --prefix qa-runtime playwright install chromium
node qa/run-browser.mjs
```

默认使用 Playwright 的 Chromium，也可将 `DSH_TEST_CHROMIUM` 指向专用测试浏览器的可执行文件。脚本创建独立 profile、启动本地 DSH、通过真实 UI 选择当前源码目录作为测试工作区，运行交互断言后关闭进程。

测试写出的 `browser-results.json`、PNG、日志、临时 profile 和运行时依赖仅用于本机测试。不要将生成的 profile 或日志作为发布包上传。代码中没有真实模型凭据；浏览器状态和临时认证由隔离 DSH 自动产生。
