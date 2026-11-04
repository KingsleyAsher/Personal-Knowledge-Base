import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
export const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',S='http://schemas.openxmlformats.org/spreadsheetml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL='http://schemas.openxmlformats.org/package/2006/relationships',CT='http://schemas.openxmlformats.org/package/2006/content-types';
export type OfficePatch={paragraphs?:Record<string,string>;added?:string[];sheets?:Record<string,Record<string,string>>};
export function parseXml(bytes:Uint8Array):XMLDocument {const source=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('不支持带 DTD 或实体的文档');const doc=new DOMParser().parseFromString(source,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('文件 XML 无法读取');return doc;}
export const elements=(node:Document|Element,namespace:string,name:string)=>Array.from(node.getElementsByTagNameNS(namespace,name));
export const attr=(node:Element|undefined,name:string,ns=W)=>node?.getAttributeNS(ns,name)??'';
export function packageFiles(bytes:Uint8Array){
 if(bytes.length>16*1024*1024)throw Error('文件超过16MiB编辑预算');let total=0,count=0;const names=new Set<string>();
 unzipSync(bytes,{filter:f=>{if(++count>2000||f.originalSize>32*1024*1024||(total+=f.originalSize)>64*1024*1024)throw Error('文件解压后超过编辑预算');if(names.has(f.name)||f.name.startsWith('/')||f.name.includes('\\')||f.name.includes(':')||f.name.split('/').some(p=>p==='..'||p==='__proto__'||p==='constructor'||p==='prototype'))throw Error('文档包路径无效');names.add(f.name);return false;}});
 return unzipSync(bytes);
}
export function parsePatch(text:string):OfficePatch{if(!text)return {};const p=JSON.parse(text);if(!p||typeof p!=='object'||Array.isArray(p))throw Error('文档草稿格式无效');return p;}
const xmlBytes=(doc:Document)=>strToU8(new XMLSerializer().serializeToString(doc));
const validText=(text:string)=>{if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('内容包含文档格式不支持的控制字符');return text;};
function safePart(base:string,target:string){const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const p of target.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');}
export interface WordParagraph {index:number;node:Element;text:string;heading:number;bold:boolean;italic:boolean;align:string;locked:boolean;images:string[]}
export class WordModel {
 files:Record<string,Uint8Array>;doc:XMLDocument;paragraphs:WordParagraph[];body:Element;protected:boolean;images=new Map<string,{bytes:Uint8Array;mime:string}>();
 constructor(bytes:Uint8Array){
  this.files=packageFiles(bytes);if(!this.files['word/document.xml'])throw Error('不是可读取的 DOCX 文档');this.doc=parseXml(this.files['word/document.xml']);this.body=elements(this.doc,W,'body')[0];if(!this.body)throw Error('文档缺少正文');
  this.protected=Object.keys(this.files).some(p=>p.startsWith('_xmlsignatures/'));
  if(this.files['word/settings.xml'])this.protected||=elements(parseXml(this.files['word/settings.xml']),W,'documentProtection').some(p=>['1','true','on'].includes(attr(p,'enforcement')));
  if(this.files['word/_rels/document.xml.rels'])for(const rel of elements(parseXml(this.files['word/_rels/document.xml.rels']),REL,'Relationship')){
   if(rel.getAttribute('TargetMode')==='External')continue;const part=safePart('word/document.xml',rel.getAttribute('Target')??''),data=this.files[part],ext=part.split('.').at(-1)?.toLowerCase();const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml'} as Record<string,string>)[ext??''];if(data&&mime)this.images.set(rel.getAttribute('Id')!,{bytes:data,mime});
  }
  this.paragraphs=elements(this.body,W,'p').map((node,index)=>{const style=attr(elements(node,W,'pStyle')[0],'val');return {index,node,text:elements(node,W,'t').map(t=>t.textContent??'').join(''),heading:Number(style.match(/(?:Heading|标题)\s*([1-6])/i)?.[1]??0),bold:elements(node,W,'b').length>0,italic:elements(node,W,'i').length>0,align:attr(elements(node,W,'jc')[0],'val')||'left',locked:['fldChar','instrText','br','tab','object','oMath'].some(n=>elements(node,W,n).length>0),images:Array.from(node.getElementsByTagNameNS('*','blip')).map(n=>n.getAttributeNS(R,'embed')??'').filter(Boolean)};});
 }
 export(patch:OfficePatch){
  if(this.protected)throw Error('文档受保护或已签名，不能在此修改');const doc=this.doc.cloneNode(true) as XMLDocument,paragraphs=elements(doc,W,'p');
  for(const [key,value]of Object.entries(patch.paragraphs??{})){
   const index=Number(key),original=this.paragraphs[index],p=paragraphs[index];if(!original||!p||original.locked||typeof value!=='string')throw Error('包含不支持编辑的段落');
   const nodes=elements(p,W,'t');if(!nodes.length){const run=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t');p.append(run);run.append(t);nodes.push(t);}
   const lines=validText(value).split(/\r?\n/),old=original.text,next=lines.shift()!;let prefix=0,suffix=0;while(prefix<old.length&&prefix<next.length&&old[prefix]===next[prefix])prefix++;while(suffix<old.length-prefix&&suffix<next.length-prefix&&old[old.length-1-suffix]===next[next.length-1-suffix])suffix++;
   const added=next.slice(prefix,next.length-suffix);let offset=0,inserted=false;
   for(const t of nodes){const text=t.textContent??'',start=offset,end=offset+text.length;offset=end;const before=text.slice(0,Math.max(0,Math.min(text.length,prefix-start))),after=text.slice(Math.max(0,old.length-suffix-start));let middle='';if(!inserted&&end>=prefix){middle=added;inserted=true;}t.textContent=before+middle+after;t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');}
   let previous=p;for(const line of lines){const np=doc.createElementNS(W,'w:p'),r=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t'),pr=Array.from(p.children).find(n=>n.localName==='pPr'),rp=elements(p,W,'rPr')[0];if(pr)np.append(pr.cloneNode(true));if(rp)r.append(rp.cloneNode(true));t.textContent=line;t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');r.append(t);np.append(r);previous.parentNode!.insertBefore(np,previous.nextSibling);previous=np;}
  }
  const body=elements(doc,W,'body')[0];for(const value of patch.added??[]){if(typeof value!=='string')throw Error('段落格式无效');for(const line of validText(value).split(/\r?\n/)){const p=doc.createElementNS(W,'w:p'),r=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t');t.textContent=line;t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');r.append(t);p.append(r);body.insertBefore(p,Array.from(body.children).find(c=>c.localName==='sectPr')??null);}}
  return zipSync({...this.files,'word/document.xml':xmlBytes(doc)},{level:6});
 }
}
export function colName(index:number){let result='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
export function address(value:string){const m=value.replaceAll('$','').toUpperCase().match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);if(!m)throw Error('请输入如 A1 的单元格位置');let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;const row=Number(m[2]);if(col>16384||row>1048576)throw Error('单元格超出表格范围');return {row,col:col-1,key:m[1]+row};}
export interface SheetCell {value:string;formula?:string;style?:string;locked:boolean}
export interface Sheet {name:string;path:string;doc:XMLDocument;cells:Map<string,SheetCell>;rows:number;cols:number;protected:boolean;lockedRanges:{start:ReturnType<typeof address>;end:ReturnType<typeof address>}[];merges:{start:ReturnType<typeof address>;end:ReturnType<typeof address>}[]}
export function cellLocked(sheet:Sheet,key:string){const a=address(key);return !!sheet.cells.get(a.key)?.locked||sheet.lockedRanges.some(r=>a.row>=r.start.row&&a.row<=r.end.row&&a.col>=r.start.col&&a.col<=r.end.col)||sheet.merges.some(r=>a.key!==r.start.key&&a.row>=r.start.row&&a.row<=r.end.row&&a.col>=r.start.col&&a.col<=r.end.col);}
export class SheetModel {
 files:Record<string,Uint8Array>;sheets:Sheet[];protected:boolean;
 constructor(bytes:Uint8Array){
  this.files=packageFiles(bytes);if(!this.files['xl/workbook.xml']||!this.files['xl/_rels/workbook.xml.rels'])throw Error('不是可读取的 XLSX 工作簿');const doc=parseXml(this.files['xl/workbook.xml']),rels=parseXml(this.files['xl/_rels/workbook.xml.rels']),shared=this.files['xl/sharedStrings.xml']?elements(parseXml(this.files['xl/sharedStrings.xml']),S,'si').map(si=>elements(si,S,'t').map(t=>t.textContent??'').join('')):[];
  this.protected=Object.keys(this.files).some(p=>p.startsWith('_xmlsignatures/'));
  this.sheets=elements(doc,S,'sheet').map(sheet=>{const rel=elements(rels,REL,'Relationship').find(r=>r.getAttribute('Id')===sheet.getAttributeNS(R,'id'));if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('不支持外部工作表');const part=safePart('xl/workbook.xml',rel.getAttribute('Target')??'');if(!this.files[part])throw Error('工作表不存在');const xml=parseXml(this.files[part]),cells=new Map<string,SheetCell>();let rows=1,cols=1;
   for(const c of elements(xml,S,'c')){const key=c.getAttribute('r')??'',a=address(key),type=c.getAttribute('t'),v=elements(c,S,'v')[0]?.textContent??'',formula=elements(c,S,'f')[0];const value=type==='s'?shared[Number(v)]??'':type==='inlineStr'?elements(c,S,'t').map(t=>t.textContent??'').join(''):type==='b'?(v==='1'?'TRUE':'FALSE'):v;cells.set(a.key,{value,formula:formula?.textContent??undefined,style:c.getAttribute('s')??undefined,locked:!!formula&&!!formula.getAttribute('t')&&formula.getAttribute('t')!=='normal'});rows=Math.max(rows,a.row);cols=Math.max(cols,a.col+1);}
   const lockedRanges=elements(xml,S,'f').filter(f=>['array','shared'].includes(f.getAttribute('t')??'')&&f.getAttribute('ref')).map(f=>{const [a,b]=f.getAttribute('ref')!.split(':');return {start:address(a),end:address(b??a)};});
   const merges=elements(xml,S,'mergeCell').map(c=>{const [a,b]=c.getAttribute('ref')!.split(':');return {start:address(a),end:address(b??a)};});
   return {name:sheet.getAttribute('name')??'工作表',path:part,doc:xml,cells,rows,cols,protected:elements(xml,S,'sheetProtection').length>0,merges,lockedRanges};
  });
 }
 export(patch:OfficePatch){
  if(this.protected)throw Error('已签名的工作簿不支持修改');const files={...this.files};
  for(const [part,changes]of Object.entries(patch.sheets??{})){
   const sheet=this.sheets.find(s=>s.path===part);if(!sheet||sheet.protected)throw Error('工作表受保护');const doc=sheet.doc.cloneNode(true) as XMLDocument,data=elements(doc,S,'sheetData')[0];if(!data)throw Error('工作表缺少数据区');
   for(const [key,value]of Object.entries(changes)){
    const a=address(key);if(typeof value!=='string'||sheet.cells.get(a.key)?.locked)throw Error('此公式区域不可在客户端修改');if(value.length>32767||value==='=')throw Error('单元格内容过长或公式不完整');validText(value);let row=elements(data,S,'row').find(r=>r.getAttribute('r')===String(a.row));if(!row){row=doc.createElementNS(S,'row');row.setAttribute('r',String(a.row));data.insertBefore(row,Array.from(data.children).find(r=>Number(r.getAttribute('r'))>a.row)??null);}let c=Array.from(row.children).find(c=>c.getAttribute('r')===a.key);if(!c){c=doc.createElementNS(S,'c');c.setAttribute('r',a.key);row.insertBefore(c,Array.from(row.children).find(n=>address(n.getAttribute('r')!).col>a.col)??null);}
    for(const n of Array.from(c.children))if(['f','v','is'].includes(n.localName))n.remove();c.removeAttribute('t');
    if(value.startsWith('=')){const f=doc.createElementNS(S,'f');f.textContent=value.slice(1);c.append(f);}
    else if(value==='TRUE'||value==='FALSE'){c.setAttribute('t','b');const v=doc.createElementNS(S,'v');v.textContent=value==='TRUE'?'1':'0';c.append(v);}
    else if(value!==''&&/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))&&value.replace(/[^0-9]/g,'').length<=15){const v=doc.createElementNS(S,'v');v.textContent=value;c.append(v);}
    else{c.setAttribute('t','inlineStr');const is=doc.createElementNS(S,'is'),t=doc.createElementNS(S,'t');t.textContent=value;t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');is.append(t);c.append(is);}
   }
   const dimension=elements(doc,S,'dimension')[0];if(dimension){let rows=sheet.rows,cols=sheet.cols;for(const key of Object.keys(changes)){const a=address(key);rows=Math.max(rows,a.row);cols=Math.max(cols,a.col+1);}dimension.setAttribute('ref','A1:'+colName(cols-1)+rows);}
   files[part]=xmlBytes(doc);
  }
  const workbook=parseXml(files['xl/workbook.xml']);let calc=elements(workbook,S,'calcPr')[0];if(!calc){calc=workbook.createElementNS(S,'calcPr');workbook.documentElement.append(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');files['xl/workbook.xml']=xmlBytes(workbook);
  if(files['xl/calcChain.xml']){delete files['xl/calcChain.xml'];const rels=parseXml(files['xl/_rels/workbook.xml.rels']);for(const r of elements(rels,REL,'Relationship'))if(r.getAttribute('Type')?.endsWith('/calcChain'))r.remove();files['xl/_rels/workbook.xml.rels']=xmlBytes(rels);const types=parseXml(files['[Content_Types].xml']);for(const r of elements(types,CT,'Override'))if(r.getAttribute('PartName')==='/xl/calcChain.xml')r.remove();files['[Content_Types].xml']=xmlBytes(types);}
  return zipSync(files,{level:6});
 }
}
export function parseCSV(text:string){const counts=new Map([[',',0],[';',0],['\t',0]]);let inQuote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(inQuote&&text[i+1]==='"')i++;else inQuote=!inQuote;}else if(!inQuote&&(c==='\n'||c==='\r'))break;else if(!inQuote&&counts.has(c))counts.set(c,counts.get(c)!+1);}const delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!field||quoted)quoted=!quoted;else field+=c;}else if(c===delimiter&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('CSV 引号未闭合');if(field||row.length||!rows.length){row.push(field);rows.push(row);}return {rows,delimiter,newline:text.includes('\r\n')?'\r\n':'\n',trailing:/[\r\n]$/.test(text)};}
export function writeCSV(data:ReturnType<typeof parseCSV>){return data.rows.map(row=>row.map(v=>v.includes(data.delimiter)||v.includes(',')||v.includes(';')||v.includes('\t')||/["\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v).join(data.delimiter)).join(data.newline)+(data.trailing?data.newline:'');}
export function newOffice(kind:'docx'|'xlsx'){
 const files:Record<string,Uint8Array>={},put=(p:string,t:string)=>files[p]=strToU8(t);
 put('_rels/.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="${kind==='docx'?'word/document.xml':'xl/workbook.xml'}"/></Relationships>`);
 if(kind==='docx'){put('[Content_Types].xml',`<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);put('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>新的文档</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);}
 else{put('[Content_Types].xml',`<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);put('xl/workbook.xml',`<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="工作表1" sheetId="1" r:id="rId1"/></sheets></workbook>`);put('xl/_rels/workbook.xml.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);put('xl/worksheets/sheet1.xml',`<worksheet xmlns="${S}"><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>新的表格</t></is></c></row></sheetData></worksheet>`);}
 return zipSync(files,{level:6});
}
