export interface Position {kind:string;target:string;high:number;last:number}
export function createPager(): {start(kind:string,target:string,high:number):Position;resolve(token:string,kind:string,target:string):Position;next(value:Position,last:number):string};
