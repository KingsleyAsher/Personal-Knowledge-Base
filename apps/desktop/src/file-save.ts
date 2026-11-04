import {api,fileName} from './types';
export async function stageFile(path:string,bytes:Uint8Array){
 if(bytes.length>16*1024*1024)throw Error('文件超过16MiB编辑预算');let stageId:string|undefined;
 for(let offset=0;offset<Math.max(1,bytes.length);offset+=220000){const part=bytes.subarray(offset,offset+220000);let raw='';for(let i=0;i<part.length;i+=8192)raw+=String.fromCharCode(...part.subarray(i,i+8192));const r=await api('fileStage',{name:fileName(path),data:btoa(raw),final:offset+220000>=bytes.length,...(stageId?{stageId}:{})});stageId=r.stageId;}
 return stageId!;
}
export function textBytes(text:string,bom=false){const bytes=new TextEncoder().encode(text);if(!bom)return bytes;const result=new Uint8Array(bytes.length+3);result.set([239,187,191]);result.set(bytes,3);return result;}
