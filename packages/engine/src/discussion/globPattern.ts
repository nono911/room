export function globToRegex(pattern: string): RegExp {
  let result = pattern.trim();
  result = result.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  result = result.replace(/\*\*\//g, '<<<GLOBSTAR_SLASH>>>');
  result = result.replace(/\*\*/g, '<<<GLOBSTAR>>>');
  result = result.replace(/\*/g, '[^/]*');
  result = result.replace(/<<<GLOBSTAR_SLASH>>>/g, '(.*/)?');
  result = result.replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${result}$`, 'i');
}
