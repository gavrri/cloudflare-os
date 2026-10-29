/** Cursors are opaque and confined to one authorized session and one result set. */
export function createPager() {
  const cursors = new Map();
  return {
    start(kind, target, high) { return {kind,target,high,last:0}; },
    resolve(token, kind, target) {
      const value=cursors.get(token);
      if(!value || value.kind!==kind || value.target!==target) throw new Error('invalid cursor');
      return value;
    },
    next(value, last) {
      if(!Number.isSafeInteger(last)||last<=value.last||last>value.high) throw new Error('invalid page');
      if(cursors.size>=10000) throw new Error('page session exhausted; reconnect');
      const token=crypto.randomUUID();cursors.set(token,{...value,last});return token;
    }
  };
}
