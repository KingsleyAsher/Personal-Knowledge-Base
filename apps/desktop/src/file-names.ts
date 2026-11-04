export function createdFileName(input:string,extension:string){
 let name=input.trim().replace(/[. ]+$/,'');const ext=extension.replace(/^\./,'').toLowerCase();
 if(!name||name==='.'||name==='..'||/[\\/]/.test(name))throw Error('请输入有效的文件名称');
 if(name.toLowerCase().endsWith('.'+ext))return name;
 // Creation keeps the chosen format. Explicit file-tree rename is intentionally separate.
 name=name.replace(/\.(md|txt|docx?|xlsx?|csv|tsv|pdf|pptx?|json|ya?ml|html?|py|[cm]?[jt]sx?)$/i,'');
 if(!name)throw Error('请输入文件名称');return name+'.'+ext;
}
