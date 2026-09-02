"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArmyExportView, type ExportArmy, type StratagemGroups } from "@/components/ArmyExportView";

export default function PublicArmyPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<{ army: ExportArmy; stratagemGroups: StratagemGroups } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/army/${token}`)
      .then(async (r) => {
        if (r.ok) setData(await r.json());
        else setError((await r.json().catch(() => ({}))).error ?? "This share link is no longer active.");
      })
      .catch(() => setError("Couldn't load this army."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-gray-300 text-lg">{error || "Army not found."}</p>
          <p className="text-gray-500 text-sm mt-2">Ask whoever sent this for an up-to-date link.</p>
        </div>
      </div>
    );
  }

  return <ArmyExportView army={data.army} stratagemGroups={data.stratagemGroups} />;
}
