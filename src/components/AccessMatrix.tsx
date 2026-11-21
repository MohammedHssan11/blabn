import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/dictionary";
import { BRANCH_GROUPS, GROUP_PERMISSIONS, ORGANIZATION_GROUPS, type BranchGroupKey, type GroupKey } from "@/modules/access/catalog";
import type { BranchInfo } from "@/modules/access/directory";
import { groupDescriptionKey, groupNameKey, permissionLabelKey } from "@/modules/access/ui";

/** Groups worth offering on a comparison-only branch: those that carry a comparison permission. */
const COMPARISON_BRANCH_GROUPS: readonly BranchGroupKey[] = ["comparison_editor", "manager"];

export interface AccessSelection {
  organizationGroups: ReadonlySet<string>;
  /** Branch codes the person belongs to. */
  branches: ReadonlySet<string>;
  /** "<branch code>:<group key>" */
  groups: ReadonlySet<string>;
}

export const EMPTY_SELECTION: AccessSelection = { organizationGroups: new Set(), branches: new Set(), groups: new Set() };

function GroupGrants({ group, t }: { group: GroupKey; t: Translator }) {
  return (
    <details>
      <summary>{t("access.groupsGrant")}</summary>
      <ul>
        {GROUP_PERMISSIONS[group].map((permission) => (
          <li key={permission}>{t(permissionLabelKey(permission))}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The branch and group choices of the staff forms: the organization groups (System Admin), then
 * one block per branch with its membership and the groups that work there. Plain checkboxes,
 * read back by `parseAccessForm`. No script is needed.
 */
export function AccessMatrix({
  locale,
  t,
  branches,
  selection = EMPTY_SELECTION,
}: {
  locale: Locale;
  t: Translator;
  branches: readonly BranchInfo[];
  selection?: AccessSelection;
}) {
  return (
    <div className="stack" data-section="access-matrix">
      <fieldset data-scope="organization">
        <legend>{t("access.organizationTitle")}</legend>
        <p className="legend" style={{ marginTop: 0 }}>
          {t("access.organizationHelp")}
        </p>
        <div className="checks">
          {ORGANIZATION_GROUPS.map((group) => (
            <label className="check" key={group}>
              <input type="checkbox" name="org_group" value={group} defaultChecked={selection.organizationGroups.has(group)} />
              <span>
                <span className="group-name">{t(groupNameKey(group))}</span>
                <small>{t(groupDescriptionKey(group))}</small>
                <GroupGrants group={group} t={t} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {branches.map((branch) => {
        const groups = branch.operatesInApp ? BRANCH_GROUPS : COMPARISON_BRANCH_GROUPS;
        const name = locale === "ar" ? branch.nameAr : branch.nameEn;
        return (
          <fieldset className="branch-fieldset" key={branch.code} data-branch={branch.code}>
            <legend>
              {name} <span className="badge">{t(branch.operatesInApp ? "access.branchKind.operational" : "access.branchKind.comparison")}</span>
            </legend>
            <p className="legend" style={{ marginTop: 0 }}>
              {t(branch.operatesInApp ? "access.branchHelpOperational" : "access.branchHelpComparison")}
            </p>
            <div className="checks">
              <label className="check">
                <input type="checkbox" name="branch" value={branch.code} defaultChecked={selection.branches.has(branch.code)} />
                <span>{t("access.memberOf")}</span>
              </label>
              {groups.map((group) => (
                <label className="check" key={group}>
                  <input type="checkbox" name="group" value={`${branch.code}:${group}`} defaultChecked={selection.groups.has(`${branch.code}:${group}`)} />
                  <span>
                    <span className="group-name">{t(groupNameKey(group))}</span>
                    <small>{t(groupDescriptionKey(group))}</small>
                    <GroupGrants group={group} t={t} />
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function selectionOf(row: { branches: string[]; groups: Array<{ group: string; branch: string | null }> }): AccessSelection {
  return {
    organizationGroups: new Set(row.groups.filter((g) => g.branch === null).map((g) => g.group)),
    branches: new Set(row.branches),
    groups: new Set(row.groups.filter((g) => g.branch !== null).map((g) => `${g.branch}:${g.group}`)),
  };
}
