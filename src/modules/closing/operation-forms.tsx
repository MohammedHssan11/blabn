import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { createTranslator, type Translator } from "@/i18n/dictionary";
import { formatMad } from "@/i18n/format";
import { toDecimalString } from "@/lib/money";
import {
  DENOMINATIONS, ENTRY_KINDS, SHIFTS, type Change, type Command,
  type OperatingData, type OperatingAccount, type Person,
} from "./operations";
import { saveOperatingAccount, saveOperatingCommand } from "./operation-actions";

export type OperatingScreen = "daily-close" | "cash-count";
export interface FormContext {
  locale: Locale;
  screen: OperatingScreen;
  date: string;
  revision: number;
  local: string;
  people: Person[];
  data: OperatingData | undefined;
  firstDay: boolean;
  actor: string;
  accounts: OperatingAccount[];
}

export function OperatingForm({ context, command, change = null, children, target, danger = false }: {
  context: FormContext;
  command: Command;
  change?: Change | null;
  children?: ReactNode;
  target?: string;
  danger?: boolean;
}) {
  const { locale, screen, date, revision } = context;
  const t = createTranslator(locale);
  const action = saveOperatingCommand.bind(null, locale, screen, date, revision, randomUUID(), command, change);
  return (
    <form className="ops-form" action={action} data-command={command} data-change={change ?? undefined}>
      {children}
      {target ? <input type="hidden" name="target" value={target} /> : null}
      {change ? <label>{t("operations.reason")}<textarea name="reason" maxLength={500} required rows={2} /></label> : null}
      <button type="submit" className={danger ? "secondary" : undefined}>{t(`operations.command.${command}`)}</button>
    </form>
  );
}

function MoneyField({ t, name, value, required }: {
  t: Translator; name: "openingCash" | "openingCustody" | "morning" | "evening" | "sales" | "posCash" |
  "card" | "amount" | "originalAmount" | "replacementAmount"; value?: number | null; required?: boolean;
}) {
  return <label>{t(`operations.${name}`)}
    <input name={name} type="text" inputMode="decimal" required={required} maxLength={30}
      defaultValue={value == null ? "" : toDecimalString(value)} />
  </label>;
}

function PersonField({ t, context, role, selected }: {
  t: Translator; context: FormContext; role: Person["role"]; selected?: Person | null;
}) {
  const name = role === "manager" ? "counter" : "cashier";
  const people = context.people.filter((person) => person.role === role);
  if (selected && !people.some((person) => person.id === selected.id)) people.unshift(selected);
  const initial = selected?.id ?? (people.some((person) => person.id === context.actor) ? context.actor : "");
  return <label>{t(`operations.${name}`)}
    <select name={name} defaultValue={initial} required>
      <option value="">{t("operations.choosePerson")}</option>
      {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select>
  </label>;
}

export function DayFields({ context }: { context: FormContext }) {
  const data = context.data;
  const t = createTranslator(context.locale);
  return <>
    {context.firstDay ? <div className="ops-fields">
      <MoneyField t={t} name="openingCash" required />
      <MoneyField t={t} name="openingCustody" required />
    </div> : null}
    <div className="ops-fields">
      <PersonField t={t} context={context} role="cashier" selected={data?.cashier} />
      <label>{t("operations.shift")}
        <select name="shift" defaultValue={data?.shift ?? ""}>
          <option value="">—</option>
          {SHIFTS.map((shift) => <option key={shift} value={shift}>{t(`operations.shifts.${shift}`)}</option>)}
        </select>
      </label>
      <MoneyField t={t} name="morning" value={data?.morning} />
      <MoneyField t={t} name="evening" value={data?.evening} />
      <MoneyField t={t} name="sales" value={data?.sales} />
      <label>{t("operations.orders")}<input name="orders" inputMode="numeric" defaultValue={data?.orders ?? ""} maxLength={10} /></label>
      <MoneyField t={t} name="posCash" value={data?.posCash} />
      <MoneyField t={t} name="card" value={data?.card} />
    </div>
    <label>{t("operations.notes")}<textarea name="notes" defaultValue={data?.notes} maxLength={500} rows={2} /></label>
  </>;
}

export function CountFields({ context }: { context: FormContext }) {
  const t = createTranslator(context.locale);
  const count = context.data?.count;
  return <>
    <div className="ops-fields">
      <PersonField t={t} context={context} role="manager" selected={count?.counter} />
      <label>{t("operations.countedAt")}
        <input name="local" type="datetime-local" required defaultValue={count?.local ?? context.local} />
      </label>
    </div>
    <fieldset>
      <legend>{t("operations.denominations")}</legend>
      <p className="legend">{t("operations.zeroCountHint")}</p>
      <div className="ops-fields ops-denominations">
        {DENOMINATIONS.map((amount) => <label key={amount}>{formatMad(amount, context.locale)}
          <input name={`qty${amount}`} inputMode="numeric" maxLength={9} defaultValue={count?.quantities[amount]} />
        </label>)}
      </div>
    </fieldset>
  </>;
}

export function EntryFields({ context, remittance = false }: { context: FormContext; remittance?: boolean }) {
  const t = createTranslator(context.locale);
  return <>
    <div className="ops-fields">
      {remittance ? null : <label>{t("operations.entryKind")}
        <select name="kind" required>{ENTRY_KINDS.map((kind) =>
          <option key={kind} value={kind}>{t(`operations.kind.${kind}`)}</option>)}
        </select>
      </label>}
      <MoneyField name="amount" t={t} required />
      <label>{t("operations.entryAt")}<input name="local" type="datetime-local" required defaultValue={context.local} /></label>
      <label>{t("operations.account")}<select name="account" defaultValue="">
        <option value="">—</option>
        {(["cash", "custody"] as const).filter((ledger) => !remittance || ledger === "cash").map((ledger) =>
          <optgroup key={ledger} label={t(`operations.ledger.${ledger}`)}>
            {context.accounts.filter((account) => account.ledger === ledger && account.active).map((account) =>
              <option key={account.id} value={account.id}>{account.code} · {account.label}</option>)}
          </optgroup>)}
      </select></label>
      <label>{t("operations.bankReference")}<input name="reference" maxLength={100} required={remittance} /></label>
    </div>
    <label>{t("operations.notes")}<textarea name="note" maxLength={500} rows={2} /></label>
  </>;
}

export function CancellationFields({ context }: { context: FormContext }) {
  const t = createTranslator(context.locale);
  return <>
    <div className="ops-fields">
      <label>{t("operations.original")}<input name="original" maxLength={80} required /></label>
      <MoneyField name="originalAmount" t={t} required />
      <label>{t("operations.originalAt")}<input name="originalLocal" type="datetime-local" required defaultValue={context.local} /></label>
      <label>{t("operations.cancelledAt")}<input name="local" type="datetime-local" required defaultValue={context.local} /></label>
      <label>{t("operations.replacement")}<input name="replacement" maxLength={80} /></label>
      <MoneyField name="replacementAmount" t={t} />
    </div>
    <label>{t("operations.cancellationReason")}<textarea name="note" maxLength={500} required rows={2} /></label>
  </>;
}
export function AccountFields({ context, account }: { context: FormContext; account?: OperatingAccount }) {
  const t = createTranslator(context.locale);
  const action = saveOperatingAccount.bind(null, context.locale, context.date, account?.id ?? null);
  return <form className="ops-form" action={action} data-command="account">
    <div className="ops-fields">
      <label>{t("operations.accountLedger")}
        <select name="ledger" defaultValue={account?.ledger ?? "cash"}>
          <option value="cash">{t("operations.ledger.cash")}</option>
          <option value="custody">{t("operations.ledger.custody")}</option>
        </select>
      </label>
      <label>{t("operations.accountCode")}<input name="code" defaultValue={account?.code} required inputMode="numeric" pattern="[0-9]{1,20}" maxLength={20} /></label>
      <label>{t("operations.accountLabel")}<input name="label" defaultValue={account?.label} required maxLength={120} /></label>
    </div>
    <label className="ops-check"><input name="active" type="checkbox" defaultChecked={account?.active ?? true} />{t("operations.accountActive")}</label>
    <button type="submit">{t("operations.saveAccount")}</button>
  </form>;
}
