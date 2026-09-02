"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ArmyExportView, type ExportArmy, type StratagemGroups } from "@/components/ArmyExportView";

export default function ExportPage() {
  const params = useParams();
  const armyId = params.id as string;
  const [army, setArmy] = useState<ExportArmy | null>(null);
  const [loading, setLoading] = useState(true);
  const [stratagemGroups, setStratagemGroups] = useState<StratagemGroups | null>(null);

  const loadArmy = useCallback(async () => {
    const res = await fetch(`/api/armies/${armyId}`);
    if (res.ok) setArmy(await res.json());
    setLoading(false);
  }, [armyId]);

  useEffect(() => { loadArmy(); }, [loadArmy]);

  useEffect(() => {
    if (!army) return;
    const params = new URLSearchParams();
    if (army.faction_id) params.set("faction_id", String(army.faction_id));
    if (army.detachments.length > 0) params.set("detachment_ids", army.detachments.map(d => d.id).join(","));
    fetch(`/api/stratagems?${params.toString()}`)
      .then(r => r.ok ? r.json() : { core: [], byDetachment: {} })
      .then(setStratagemGroups);
  }, [army?.faction_id, army?.detachments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!army)   return <div className="p-8 text-gray-400">Army not found.</div>;

  return (
    <ArmyExportView
      army={army}
      stratagemGroups={stratagemGroups}
      backHref={army.is_owner ? `/armies/${armyId}` : "/armies"}
    />
  );
}
