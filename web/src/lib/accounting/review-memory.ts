import {AccountingError} from "./model";
import type {ReviewTx,ReviewSubject,ReviewDecision} from "./review";
export type ReviewMemoryState={nextProduct:number;productIds:string[];subjects:ReviewSubject[];decisions:ReviewDecision[]};
export const createReviewMemoryState=():ReviewMemoryState=>({nextProduct:1,productIds:[],subjects:[],decisions:[]});
export function memoryReviewTx(state:ReviewMemoryState):ReviewTx{return {
 async nextProductId(){const id=String(state.nextProduct++);state.productIds.push(id);return id;},
 async reviewSubject(kind,id){return structuredClone(state.subjects.filter(s=>s.kind===kind&&s.id===id).at(-1)??null);},
 async reviewSubjects(kind){const latest=new Map<string,ReviewSubject>();for(const s of state.subjects.filter(s=>s.kind===kind))latest.set(s.id,s);return structuredClone([...latest.values()]);},
 async appendReviewSubject(s){if(s.kind==="product"&&!state.productIds.includes(s.id))throw new AccountingError("invalid_product_id");state.subjects.push(structuredClone(s));},
 async reviewDecisions(id){return structuredClone(state.decisions.filter(d=>d.subjectId===id));},
 async reviewCommand(key){return structuredClone(state.decisions.find(d=>d.key===key)??null);},
 async appendReview(d){if(state.decisions.some(v=>v.id===d.id||v.key===d.key))throw new AccountingError("command_conflict");state.decisions.push(structuredClone(d));},
};}
