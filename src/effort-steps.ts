export function effortSteps(levels: string[]) {
  const configured = [...new Set(levels.filter(level => level !== '' && level !== 'none'))]
  return [...(levels.includes('none') ? ['none'] : []), '', ...configured]
}
