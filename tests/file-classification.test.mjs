import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyFile} from '../packages/kb-core/src/file-classification.js'

const file=(name,extra={})=>({path:'90-收件箱/原件归档/2026-11-06/174418-92ac/'+name,title:name,category:'90-收件箱/原件归档/2026-11-06/174418-92ac',kind:'素材',tags:[],...extra})
test('generated deliverables stay in their own tree with task subfolders',()=>{
 assert.equal(classifyFile(file('数学分析.pdf',{path:'任务成品/数学分析.pdf'})).category,'任务成品')
 assert.equal(classifyFile(file('DSH.md',{path:'任务成品/客户端设计/DSH.md'})).category,'任务成品/客户端设计')
 assert.equal(classifyFile(file('note.md',{path:'任务成品/note.md',manual:true,category:'手工收藏'})).category,'手工收藏')
})
test('archive dates and IDs are storage locations; clear subject evidence supplies useful categories',()=>{
 assert.equal(classifyFile(file('数学分析第一节.m4a')).category,'学习与课程/数学分析')
 assert.equal(classifyFile(file('高等代数讲义.pdf')).category,'学习与课程/高等代数')
 assert.equal(classifyFile(file('散文-灯借一夜.md')).category,'写作与创作/文学写作')
 assert.equal(classifyFile(file('DSH客户端设计.md')).category,'项目与开发/智能工具')
 assert.equal(classifyFile(file('unknown.pdf')).category,'待分类')
 assert.equal(classifyFile(file('原件.png')).category,'资料与素材/图片')
})
test('user categories survive; numbered legacy roots become readable and dates never become topics',()=>{
 assert.equal(classifyFile(file('数学分析.pdf',{manual:true,category:'我的阅读/周末'})).category,'我的阅读/周末')
 assert.equal(classifyFile(file('数学分析.pdf',{originalCategory:'课堂/复习'})).category,'课堂/复习')
 assert.equal(classifyFile(file('project.md',{category:'10-项目/小工具'})).category,'项目与开发/小工具')
 assert.equal(classifyFile(file('archive.md',{category:'00-画像/_archive/2026-10-17_old',kind:'画像'})).category,'个人与关系/个人资料')
})
test('derivatives and management files retain a distinct role without deleting them',()=>{
 assert.equal(classifyFile(file('p001.json',{path:'50-底稿/数学分析-OCR/p001.json',category:'50-底稿/数学分析-OCR'})).presentationRole,'derived')
 assert.equal(classifyFile(file('请求.md',{path:'00-知识库请求通道/请求.md'})).presentationRole,'support')
 assert.equal(classifyFile(file('原件.json')).presentationRole,'original','a JSON original outside processing storage is not hidden just for its extension')
})
