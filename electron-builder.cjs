module.exports={
  appId:'com.claudeworkspace.desktop',
  productName:'Claude Workspace',
  directories:{output:'release'},
  files:['electron/**/*.cjs','electron/topology-skill.md','dist/**/*','package.json','THIRD_PARTY_NOTICES.md','licenses/**/*','!node_modules/**/*'],
  asar:true,
  asarUnpack:['electron/browser-mcp.cjs','electron/browser-tools.cjs'],
  electronLanguages:['zh-CN','en-US'],
  win:{target:[{target:'nsis',arch:['x64']},{target:'portable',arch:['x64']}],signAndEditExecutable:false,artifactName:'Claude-Workspace-${version}-${arch}.${ext}'},
  nsis:{artifactName:'Claude-Workspace-Setup-${version}-${arch}.${ext}',oneClick:true,perMachine:false,createDesktopShortcut:true,createStartMenuShortcut:true,deleteAppDataOnUninstall:false},
  portable:{requestExecutionLevel:'user'},
  compression:'normal'
}
