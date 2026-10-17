// IPC recreates objects on every snapshot. Dirty checks compare content rather
// than object identity, including nested preferences such as modelImageInputs.
export function sameSettingValue(a:unknown,b:unknown):boolean{
  if(Object.is(a,b))return true
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameSettingValue(v,b[i]))
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>
  const keys=Object.keys(left).filter(k=>left[k]!==undefined),other=Object.keys(right).filter(k=>right[k]!==undefined)
  return keys.length===other.length&&keys.every(k=>Object.hasOwn(right,k)&&sameSettingValue(left[k],right[k]))
}
