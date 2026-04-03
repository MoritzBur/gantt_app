import React, { useEffect, useMemo, useState } from 'react';

function clonePersonnel(personnel) {
  return JSON.parse(JSON.stringify(personnel || { version: 1, teams: [], members: [] }));
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

function TeamCard({ team, members, onChange, onDelete }) {
  return (
    <div className="personnel-card">
      <div className="personnel-card-header">
        <input
          className="form-input"
          type="text"
          value={team.name}
          placeholder="Team name"
          onChange={(event) => onChange({ ...team, name: event.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={onDelete}>
          Delete
        </button>
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
          <span className="muted">No members yet</span>
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

function MemberCard({ member, teams, onChange, onDelete }) {
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
          placeholder="Member name"
          onChange={(event) => onChange({ ...member, name: event.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={onDelete}>
          Delete
        </button>
      </div>
      <textarea
        className="form-input form-textarea"
        rows={2}
        placeholder="Comment"
        value={member.comment || ''}
        onChange={(event) => onChange({ ...member, comment: event.target.value })}
      />
      <div className="personnel-team-select">
        <div className="personnel-section-title">Teams</div>
        {(teams || []).length > 0 ? teams.map((team) => (
          <label key={team.id} className="personnel-team-check">
            <input
              type="checkbox"
              checked={(member.teamIds || []).includes(team.id)}
              onChange={() => toggleTeam(team.id)}
            />
            <span>{team.name}</span>
          </label>
        )) : (
          <span className="muted">Create a team to group people together.</span>
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

export default function PersonnelManagerModal({ personnel, onSave, onClose }) {
  const [draft, setDraft] = useState(() => clonePersonnel(personnel));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(clonePersonnel(personnel));
  }, [personnel]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const membersByTeam = useMemo(() => {
    const map = new Map();
    for (const team of draft.teams || []) {
      map.set(team.id, (draft.members || []).filter((member) => (member.teamIds || []).includes(team.id)));
    }
    return map;
  }, [draft]);

  const structureTeams = useMemo(
    () => [...(draft.teams || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [draft.teams]
  );
  const unassignedMembers = useMemo(
    () => (draft.members || []).filter((member) => !member.teamIds || member.teamIds.length === 0).sort((a, b) => a.name.localeCompare(b.name)),
    [draft.members]
  );

  const updateTeam = (teamId, nextTeam) => {
    setDraft((current) => ({
      ...current,
      teams: current.teams.map((team) => (team.id === teamId ? nextTeam : team)),
    }));
  };

  const updateMember = (memberId, nextMember) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member) => (member.id === memberId ? nextMember : member)),
    }));
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

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const cleaned = {
      version: 1,
      teams: (draft.teams || []).map((team) => ({
        ...team,
        name: String(team.name || '').trim(),
        comment: team.comment || '',
        fields: (team.fields || []).filter((field) => field.key || field.value),
      })).filter((team) => team.name),
      members: (draft.members || []).map((member) => ({
        ...member,
        name: String(member.name || '').trim(),
        comment: member.comment || '',
        teamIds: Array.from(new Set(member.teamIds || [])),
        fields: (member.fields || []).filter((field) => field.key || field.value),
      })).filter((member) => member.name),
    };
    const ok = await onSave(cleaned);
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal personnel-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Manage Team</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body personnel-modal-body">
          <div className="personnel-toolbar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft((current) => ({
                ...current,
                teams: [...current.teams, { id: crypto.randomUUID(), name: '', comment: '', fields: [] }],
              }))}
            >
              Add Team
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft((current) => ({
                ...current,
                members: [...current.members, { id: crypto.randomUUID(), name: '', comment: '', teamIds: [], fields: [] }],
              }))}
            >
              Add Member
            </button>
          </div>

          <div className="personnel-columns">
            <section className="personnel-column">
              <div className="personnel-column-title">Teams</div>
              {(draft.teams || []).length > 0 ? draft.teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  members={membersByTeam.get(team.id)}
                  onChange={(nextTeam) => updateTeam(team.id, nextTeam)}
                  onDelete={() => deleteTeam(team.id)}
                />
              )) : (
                <div className="personnel-empty-state">No teams yet.</div>
              )}
            </section>

            <section className="personnel-column">
              <div className="personnel-column-title">Members</div>
              {(draft.members || []).length > 0 ? draft.members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  teams={draft.teams || []}
                  onChange={(nextMember) => updateMember(member.id, nextMember)}
                  onDelete={() => deleteMember(member.id)}
                />
              )) : (
                <div className="personnel-empty-state">No members yet.</div>
              )}
            </section>
          </div>

          <section className="personnel-structure">
            <div className="personnel-column-title">Structure Preview</div>
            {structureTeams.map((team) => (
              <div key={team.id} className="personnel-structure-row">
                <div className="personnel-structure-name">{team.name}</div>
                <div className="personnel-chip-row">
                  {(membersByTeam.get(team.id) || []).length > 0 ? membersByTeam.get(team.id).map((member) => (
                    <span key={member.id} className="personnel-chip">{member.name}</span>
                  )) : (
                    <span className="muted">No members assigned</span>
                  )}
                </div>
              </div>
            ))}
            {unassignedMembers.length > 0 && (
              <div className="personnel-structure-row">
                <div className="personnel-structure-name">Unassigned</div>
                <div className="personnel-chip-row">
                  {unassignedMembers.map((member) => (
                    <span key={member.id} className="personnel-chip">{member.name}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
        <div className="modal-footer">
          <div className="modal-footer-right">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Team'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
