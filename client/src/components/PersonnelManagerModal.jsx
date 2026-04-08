import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ASSET_TYPE,
  getAssetTypeMap,
  getDefaultAssetType,
  getGroupNamesForMember,
  getTeamMap,
  groupPersonnelByType,
  rgbaFromHex,
} from '../utils/resourcePlanning.js';

function clonePersonnel(personnel) {
  return JSON.parse(JSON.stringify(personnel || { version: 2, types: [DEFAULT_ASSET_TYPE], teams: [], members: [] }));
}

function createType() {
  return {
    id: crypto.randomUUID(),
    name: '',
    comment: '',
    color: '#4A90D9',
    groupLabel: 'Group',
    groupLabelPlural: 'Groups',
    assetLabel: 'Asset',
    assetLabelPlural: 'Assets',
  };
}

function createGroup(typeId) {
  return { id: crypto.randomUUID(), typeId, name: '', comment: '', fields: [] };
}

function createAsset(typeId) {
  return { id: crypto.randomUUID(), typeId, name: '', comment: '', teamIds: [], fields: [] };
}

function FieldListEditor({ title, fields, onChange }) {
  const updateField = (index, key, value) => {
    onChange(fields.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, [key]: value } : field
    )));
  };

  const removeField = (index) => {
    onChange(fields.filter((_, fieldIndex) => fieldIndex !== index));
  };

  return (
    <div className="personnel-fields">
      <div className="personnel-section-title">{title}</div>
      {fields.map((field, index) => (
        <div key={`${field.key}-${index}`} className="personnel-field-row">
          <input
            className="form-input"
            type="text"
            placeholder="Field name"
            value={field.key}
            onChange={(event) => updateField(index, 'key', event.target.value)}
          />
          <input
            className="form-input"
            type="text"
            placeholder="Value"
            value={field.value}
            onChange={(event) => updateField(index, 'value', event.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => removeField(index)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={() => onChange([...(fields || []), { key: '', value: '' }])}
      >
        Add Field
      </button>
    </div>
  );
}

function TypeCard({ assetType, hasMembers, hasGroups, onChange, onDelete, disableDelete }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const previewGroupLabel = assetType.groupLabelPlural || assetType.groupLabel || 'Groups';
  const previewAssetLabel = assetType.assetLabelPlural || assetType.assetLabel || 'Assets';

  return (
    <div className="personnel-card personnel-type-card">
      <div
        className="personnel-type-card-accent"
        style={{ backgroundColor: rgbaFromHex(assetType.color, 0.16), borderColor: rgbaFromHex(assetType.color, 0.28) }}
      >
        <span className="personnel-type-swatch" style={{ backgroundColor: assetType.color }} />
        <span>{assetType.name || 'New asset type'}</span>
      </div>

      <div className="personnel-card-header">
        <input
          className="form-input"
          type="text"
          value={assetType.name}
          placeholder="Asset type name"
          onChange={(event) => onChange({ ...assetType, name: event.target.value })}
        />
        <input
          className="personnel-color-input"
          type="color"
          value={assetType.color || '#4A90D9'}
          onChange={(event) => onChange({ ...assetType, color: event.target.value })}
          aria-label={`${assetType.name || 'Asset type'} color`}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={onDelete} disabled={disableDelete}>
          Delete
        </button>
      </div>

      <textarea
        className="form-input form-textarea"
        rows={2}
        placeholder="Comment"
        value={assetType.comment || ''}
        onChange={(event) => onChange({ ...assetType, comment: event.target.value })}
      />

      <div className="personnel-type-preview">
        <div className="personnel-section-title">UI Preview</div>
        <p className="personnel-helper-copy">
          This type will appear as <strong>{previewGroupLabel}</strong> containing assignable <strong>{previewAssetLabel}</strong>.
        </p>
      </div>

      <div className="personnel-advanced-panel">
        <button
          type="button"
          className="btn btn-ghost btn-small personnel-advanced-toggle"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? 'Hide Advanced Wording' : 'Customize Wording'}
        </button>
        {advancedOpen && (
          <>
            <p className="personnel-helper-copy">
              Optional: rename the generic words shown in the UI. Example: Groups can become Fleets and Assets can become Boats.
            </p>
            <div className="personnel-type-label-grid">
              <label className="personnel-inline-field">
                <span className="personnel-section-title">Single group word</span>
                <input
                  className="form-input"
                  type="text"
                  value={assetType.groupLabel || ''}
                  onChange={(event) => onChange({ ...assetType, groupLabel: event.target.value })}
                  placeholder="Team"
                />
              </label>
              <label className="personnel-inline-field">
                <span className="personnel-section-title">Plural group word</span>
                <input
                  className="form-input"
                  type="text"
                  value={assetType.groupLabelPlural || ''}
                  onChange={(event) => onChange({ ...assetType, groupLabelPlural: event.target.value })}
                  placeholder="Teams"
                />
              </label>
              <label className="personnel-inline-field">
                <span className="personnel-section-title">Single asset word</span>
                <input
                  className="form-input"
                  type="text"
                  value={assetType.assetLabel || ''}
                  onChange={(event) => onChange({ ...assetType, assetLabel: event.target.value })}
                  placeholder="Person"
                />
              </label>
              <label className="personnel-inline-field">
                <span className="personnel-section-title">Plural asset word</span>
                <input
                  className="form-input"
                  type="text"
                  value={assetType.assetLabelPlural || ''}
                  onChange={(event) => onChange({ ...assetType, assetLabelPlural: event.target.value })}
                  placeholder="People"
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div className="personnel-type-meta">
        <span>{hasGroups ? 'Has groups' : 'No groups yet'}</span>
        <span>{hasMembers ? 'Has assets' : 'No assets yet'}</span>
      </div>
    </div>
  );
}

function GroupCard({ team, assetTypes, members, onChange, onDelete }) {
  return (
    <div className="personnel-card">
      <div className="personnel-card-header">
        <input
          className="form-input"
          type="text"
          value={team.name}
          placeholder="Group name"
          onChange={(event) => onChange({ ...team, name: event.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={onDelete}>
          Delete
        </button>
      </div>

      <div className="personnel-group-row">
        <label className="personnel-inline-field">
          <span className="personnel-section-title">Asset type</span>
          <select
            className="form-input"
            value={team.typeId || assetTypes[0]?.id || DEFAULT_ASSET_TYPE.id}
            onChange={(event) => onChange({ ...team, typeId: event.target.value })}
          >
            {assetTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name || 'Untitled type'}</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        className="form-input form-textarea"
        rows={2}
        placeholder="Comment"
        value={team.comment || ''}
        onChange={(event) => onChange({ ...team, comment: event.target.value })}
      />

      <div className="personnel-team-members">
        {(members || []).length > 0 ? members.map((member) => (
          <span key={member.id} className="personnel-chip">{member.name}</span>
        )) : (
          <span className="muted">No assets assigned yet</span>
        )}
      </div>

      <FieldListEditor
        title="Custom Fields"
        fields={team.fields || []}
        onChange={(fields) => onChange({ ...team, fields })}
      />
    </div>
  );
}

function AssetCard({ member, teams, assetTypes, onChange, onDelete }) {
  const selectedTypeId = member.typeId || assetTypes[0]?.id || DEFAULT_ASSET_TYPE.id;
  const compatibleTeams = teams.filter((team) => team.typeId === selectedTypeId);

  const toggleTeam = (teamId) => {
    const current = new Set(member.teamIds || []);
    if (current.has(teamId)) current.delete(teamId);
    else current.add(teamId);
    onChange({ ...member, teamIds: [...current] });
  };

  return (
    <div className="personnel-card">
      <div className="personnel-card-header">
        <input
          className="form-input"
          type="text"
          value={member.name}
          placeholder="Asset name"
          onChange={(event) => onChange({ ...member, name: event.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={onDelete}>
          Delete
        </button>
      </div>

      <div className="personnel-group-row">
        <label className="personnel-inline-field">
          <span className="personnel-section-title">Asset type</span>
          <select
            className="form-input"
            value={selectedTypeId}
            onChange={(event) => onChange({
              ...member,
              typeId: event.target.value,
              teamIds: (member.teamIds || []).filter((teamId) => teams.some((team) => team.id === teamId && team.typeId === event.target.value)),
            })}
          >
            {assetTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name || 'Untitled type'}</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        className="form-input form-textarea"
        rows={2}
        placeholder="Comment"
        value={member.comment || ''}
        onChange={(event) => onChange({ ...member, comment: event.target.value })}
      />

      <div className="personnel-team-select">
        <div className="personnel-section-title">Groups</div>
        {compatibleTeams.length > 0 ? compatibleTeams.map((team) => (
          <label key={team.id} className="personnel-team-check">
            <input
              type="checkbox"
              checked={(member.teamIds || []).includes(team.id)}
              onChange={() => toggleTeam(team.id)}
            />
            <span>{team.name}</span>
          </label>
        )) : (
          <span className="muted">Create a matching group for this asset type first.</span>
        )}
      </div>

      <FieldListEditor
        title="Custom Fields"
        fields={member.fields || []}
        onChange={(fields) => onChange({ ...member, fields })}
      />
    </div>
  );
}

const TABS = [
  { id: 'types', label: 'Asset Types' },
  { id: 'groups', label: 'Groups' },
  { id: 'assets', label: 'Assets' },
  { id: 'overview', label: 'Overview' },
];

export default function PersonnelManagerModal({ personnel, onSave, onClose }) {
  const [draft, setDraft] = useState(() => clonePersonnel(personnel));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('types');
  const [pendingScrollTarget, setPendingScrollTarget] = useState(null);
  const typeRefs = useRef(new Map());
  const teamRefs = useRef(new Map());
  const memberRefs = useRef(new Map());

  useEffect(() => {
    setDraft(clonePersonnel(personnel));
  }, [personnel]);

  useEffect(() => {
    if (!pendingScrollTarget) return;
    const registry = pendingScrollTarget.kind === 'type'
      ? typeRefs.current
      : pendingScrollTarget.kind === 'group'
        ? teamRefs.current
        : memberRefs.current;
    const element = registry.get(pendingScrollTarget.id);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const input = element.querySelector('input, textarea, select');
    input?.focus();
    setPendingScrollTarget(null);
  }, [draft, pendingScrollTarget]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const assetTypes = useMemo(() => {
    const types = Array.isArray(draft.types) && draft.types.length > 0 ? draft.types : [DEFAULT_ASSET_TYPE];
    return types;
  }, [draft.types]);
  const assetTypeMap = useMemo(() => getAssetTypeMap(draft), [draft]);
  const fallbackType = useMemo(() => getDefaultAssetType(draft), [draft]);
  const teamMap = useMemo(() => getTeamMap(draft), [draft]);
  const membersByTeam = useMemo(() => {
    const map = new Map();
    for (const team of draft.teams || []) {
      map.set(team.id, (draft.members || []).filter((member) => (member.teamIds || []).includes(team.id)));
    }
    return map;
  }, [draft]);
  const groupedTypes = useMemo(() => (
    groupPersonnelByType(draft).map(({ type, teams, members }) => ({
      type,
      teams: [...teams].sort((a, b) => a.name.localeCompare(b.name)),
      members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    }))
  ), [draft]);

  const updateType = (typeId, nextType) => {
    setDraft((current) => ({
      ...current,
      types: current.types.map((type) => (type.id === typeId ? nextType : type)),
    }));
  };

  const updateTeam = (teamId, nextTeam) => {
    setDraft((current) => ({
      ...current,
      teams: current.teams.map((team) => (team.id === teamId ? nextTeam : team)),
      members: current.members.map((member) => (
        member.typeId === nextTeam.typeId
          ? member
          : { ...member, teamIds: (member.teamIds || []).filter((id) => id !== teamId) }
      )),
    }));
  };

  const updateMember = (memberId, nextMember) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member) => (member.id === memberId ? nextMember : member)),
    }));
  };

  const deleteType = (typeId) => {
    setDraft((current) => {
      const remainingTypes = current.types.filter((type) => type.id !== typeId);
      const nextFallbackType = remainingTypes[0] || DEFAULT_ASSET_TYPE;
      return {
        ...current,
        types: remainingTypes.length > 0 ? remainingTypes : [DEFAULT_ASSET_TYPE],
        teams: current.teams.map((team) => (
          team.typeId === typeId ? { ...team, typeId: nextFallbackType.id } : team
        )),
        members: current.members.map((member) => (
          member.typeId === typeId ? { ...member, typeId: nextFallbackType.id } : member
        )),
      };
    });
  };

  const deleteTeam = (teamId) => {
    setDraft((current) => ({
      ...current,
      teams: current.teams.filter((team) => team.id !== teamId),
      members: current.members.map((member) => ({
        ...member,
        teamIds: (member.teamIds || []).filter((id) => id !== teamId),
      })),
    }));
  };

  const deleteMember = (memberId) => {
    setDraft((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== memberId),
    }));
  };

  const handleAddForTab = () => {
    if (activeTab === 'types') {
      const nextType = createType();
      setDraft((current) => ({ ...current, types: [...assetTypes, nextType] }));
      setPendingScrollTarget({ kind: 'type', id: nextType.id });
      return;
    }
    if (activeTab === 'groups') {
      const nextGroup = createGroup(assetTypes[0]?.id || fallbackType.id);
      setDraft((current) => ({ ...current, teams: [...current.teams, nextGroup] }));
      setPendingScrollTarget({ kind: 'group', id: nextGroup.id });
      return;
    }
    if (activeTab === 'assets') {
      const nextAsset = createAsset(assetTypes[0]?.id || fallbackType.id);
      setDraft((current) => ({ ...current, members: [...current.members, nextAsset] }));
      setPendingScrollTarget({ kind: 'asset', id: nextAsset.id });
    }
  };

  const toolbarLabel = activeTab === 'types'
    ? 'Add Asset Type'
    : activeTab === 'groups'
      ? 'Add Group'
      : activeTab === 'assets'
        ? 'Add Asset'
        : null;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const cleanedTypes = assetTypes.map((type, index) => {
      const fallback = index === 0 ? DEFAULT_ASSET_TYPE : null;
      return {
        ...type,
        name: String(type.name || '').trim(),
        comment: type.comment || '',
        color: /^#[0-9a-fA-F]{6}$/.test(type.color || '') ? type.color : (fallback?.color || '#4A90D9'),
        groupLabel: String(type.groupLabel || '').trim() || (fallback?.groupLabel || 'Group'),
        groupLabelPlural: String(type.groupLabelPlural || '').trim() || (fallback?.groupLabelPlural || 'Groups'),
        assetLabel: String(type.assetLabel || '').trim() || (fallback?.assetLabel || 'Asset'),
        assetLabelPlural: String(type.assetLabelPlural || '').trim() || (fallback?.assetLabelPlural || 'Assets'),
      };
    }).filter((type) => type.name);

    const validTypeIds = new Set(cleanedTypes.map((type) => type.id));
    const effectiveDefaultTypeId = cleanedTypes[0]?.id || DEFAULT_ASSET_TYPE.id;
    const cleanedTeams = (draft.teams || []).map((team) => ({
      ...team,
      name: String(team.name || '').trim(),
      comment: team.comment || '',
      typeId: validTypeIds.has(team.typeId) ? team.typeId : effectiveDefaultTypeId,
      fields: (team.fields || []).filter((field) => field.key || field.value),
    })).filter((team) => team.name);
    const validTeamMap = new Map(cleanedTeams.map((team) => [team.id, team]));
    const cleanedMembers = (draft.members || []).map((member) => ({
      ...member,
      name: String(member.name || '').trim(),
      comment: member.comment || '',
      typeId: validTypeIds.has(member.typeId) ? member.typeId : effectiveDefaultTypeId,
      teamIds: Array.from(new Set((member.teamIds || []).filter((teamId) => validTeamMap.get(teamId)?.typeId === (validTypeIds.has(member.typeId) ? member.typeId : effectiveDefaultTypeId)))),
      fields: (member.fields || []).filter((field) => field.key || field.value),
    })).filter((member) => member.name);

    const ok = await onSave({
      version: 2,
      types: cleanedTypes.length > 0 ? cleanedTypes : [DEFAULT_ASSET_TYPE],
      teams: cleanedTeams,
      members: cleanedMembers,
    });
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal personnel-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Manage Assets</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body personnel-modal-body">
          <section className="personnel-concept-panel">
            <div>
              <div className="personnel-column-title">Flexible Planning Model</div>
              <p className="personnel-concept-copy">
                Start simple: create a type like Personnel or Coach Boats, add a few groups if you want them, then add the actual assignable assets. Deeper wording customization is available only when you need it.
              </p>
            </div>
            <div className="personnel-summary-grid">
              <div className="personnel-summary-card">
                <strong>{assetTypes.length}</strong>
                <span>Asset types</span>
              </div>
              <div className="personnel-summary-card">
                <strong>{(draft.teams || []).length}</strong>
                <span>Groups</span>
              </div>
              <div className="personnel-summary-card">
                <strong>{(draft.members || []).length}</strong>
                <span>Assets</span>
              </div>
            </div>
          </section>

          <div className="personnel-tabs" role="tablist" aria-label="Asset management sections">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`personnel-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="personnel-toolbar">
            {toolbarLabel && (
              <button type="button" className="btn btn-secondary" onClick={handleAddForTab}>
                {toolbarLabel}
              </button>
            )}
          </div>

          {activeTab === 'types' && (
            <section className="personnel-column">
              <div className="personnel-column-title">Asset Types</div>
              <p className="personnel-helper-copy">
                A type is a category of assignable things. Examples: Personnel, Coach Boats, Cars.
              </p>
              {assetTypes.length > 0 ? assetTypes.map((assetType) => (
                <div
                  key={assetType.id}
                  ref={(node) => {
                    if (node) typeRefs.current.set(assetType.id, node);
                    else typeRefs.current.delete(assetType.id);
                  }}
                >
                  <TypeCard
                    assetType={assetType}
                    hasGroups={(draft.teams || []).some((team) => (team.typeId || fallbackType.id) === assetType.id)}
                    hasMembers={(draft.members || []).some((member) => (member.typeId || fallbackType.id) === assetType.id)}
                    onChange={(nextType) => updateType(assetType.id, nextType)}
                    onDelete={() => deleteType(assetType.id)}
                    disableDelete={assetTypes.length === 1}
                  />
                </div>
              )) : (
                <div className="personnel-empty-state">No asset types yet.</div>
              )}
            </section>
          )}

          {activeTab === 'groups' && (
            <section className="personnel-column">
              <div className="personnel-column-title">Groups</div>
              <p className="personnel-helper-copy">
                Groups are optional collections inside a type. Examples: Testing Team, RIB Fleet, Vehicle Pool.
              </p>
              {(draft.teams || []).length > 0 ? draft.teams.map((team) => (
                <div
                  key={team.id}
                  ref={(node) => {
                    if (node) teamRefs.current.set(team.id, node);
                    else teamRefs.current.delete(team.id);
                  }}
                >
                  <GroupCard
                    team={team}
                    assetTypes={assetTypes}
                    members={membersByTeam.get(team.id)}
                    onChange={(nextTeam) => updateTeam(team.id, nextTeam)}
                    onDelete={() => deleteTeam(team.id)}
                  />
                </div>
              )) : (
                <div className="personnel-empty-state">No groups yet.</div>
              )}
            </section>
          )}

          {activeTab === 'assets' && (
            <section className="personnel-column">
              <div className="personnel-column-title">Assets</div>
              <p className="personnel-helper-copy">
                Assets are the actual things you assign to tasks, like Peter or Coach Boat 1.
              </p>
              {(draft.members || []).length > 0 ? draft.members.map((member) => (
                <div
                  key={member.id}
                  ref={(node) => {
                    if (node) memberRefs.current.set(member.id, node);
                    else memberRefs.current.delete(member.id);
                  }}
                >
                  <AssetCard
                    member={member}
                    teams={draft.teams || []}
                    assetTypes={assetTypes}
                    onChange={(nextMember) => updateMember(member.id, nextMember)}
                    onDelete={() => deleteMember(member.id)}
                  />
                </div>
              )) : (
                <div className="personnel-empty-state">No assets yet.</div>
              )}
            </section>
          )}

          {activeTab === 'overview' && (
            <section className="personnel-structure">
              <div className="personnel-column-title">Planning Structure</div>
              {groupedTypes.map(({ type, teams, members }) => {
                const unassignedMembers = members.filter((member) => (member.teamIds || []).length === 0);
                return (
                  <div key={type.id} className="personnel-overview-type">
                    <div
                      className="personnel-overview-type-header"
                      style={{ backgroundColor: rgbaFromHex(type.color, 0.12), borderColor: rgbaFromHex(type.color, 0.28) }}
                    >
                      <span className="personnel-type-swatch" style={{ backgroundColor: type.color }} />
                      <div>
                        <div className="personnel-structure-name">{type.name}</div>
                        <div className="muted">{type.groupLabelPlural} and {type.assetLabelPlural}</div>
                      </div>
                    </div>

                    {teams.map((team) => (
                      <div key={team.id} className="personnel-structure-row">
                        <div className="personnel-structure-name">{team.name}</div>
                        <div className="personnel-chip-row">
                          {(membersByTeam.get(team.id) || []).length > 0 ? membersByTeam.get(team.id).map((member) => (
                            <span key={member.id} className="personnel-chip">{member.name}</span>
                          )) : (
                            <span className="muted">No assets assigned</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {unassignedMembers.length > 0 && (
                      <div className="personnel-structure-row">
                        <div className="personnel-structure-name">Ungrouped</div>
                        <div className="personnel-chip-row">
                          {unassignedMembers.map((member) => (
                            <span key={member.id} className="personnel-chip">{member.name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {groupedTypes.every(({ teams, members }) => teams.length === 0 && members.length === 0) && (
                <div className="personnel-empty-state">Start by creating an asset type, then add groups and assets.</div>
              )}
            </section>
          )}
        </div>
        <div className="modal-footer">
          <div className="modal-footer-right">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Assets'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
