import path from 'node:path';
// Packaged launches and the former real-library launcher share one persistent
// profile. Explicit test/development overrides always take precedence.
export function desktopDataPath({override,packaged,home,appDir}){
 return path.resolve(override??(packaged?path.join(home,'.dsh','knowledge-desktop-client'):path.join(appDir,'.runtime')));
}
