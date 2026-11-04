"use client";
import { useActionState, type ReactNode } from "react";
import { useT } from "./I18nProvider";
import { receiptText } from "@/lib/accounting/receipt-messages";
export function AccountingActionForm({action,children,className}:{action:(form:FormData)=>Promise<void>;locale:"en"|"es";children:ReactNode;className?:string}) {
 const t=useT();
 const [error,submit,pending]=useActionState(async(_previous:boolean|null,form:FormData)=>{try{await action(form);return null;}catch{return true;}},null);
 return <form action={submit} className={className} aria-busy={pending}><fieldset disabled={pending} className="contents">{children}</fieldset>{error&&<p role="alert" className="basis-full text-sm text-negative">{receiptText(t.locale,"accounting.receipts.error")}</p>}</form>;
}
