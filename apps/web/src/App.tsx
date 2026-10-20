import React, { useState } from 'react';
import {
  parseProcurementRequest,
  evaluateAndRankCandidates,
  type ProcurementRequirement,
  type CandidateEvaluation,
} from '../../../packages/shared/src/index.js';

export default function App() {
  const [prompt, setPrompt] = useState(
    'Find five 12V DC motors with a metal gearbox, rated torque above 5 kg-cm, available in India, under ₹500 each, delivered to my pincode 124001 within seven days.'
  );
  const [requirement, setRequirement] = useState<ProcurementRequirement | null>(null);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleRunResearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/research/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const data = await res.json();
        setRequirement(data.requirement);
        setEvaluations(data.evaluations);
      } else {
        const parsed = parseProcurementRequest(prompt);
        setRequirement(parsed);
        setEvaluations(evaluateAndRankCandidates([], parsed));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <header className="max-w-7xl mx-auto flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SupplySense</h1>
          <p className="text-sm text-slate-400">Find anything. Verify everything. Buy with confidence.</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto space-y-6">
        <form onSubmit={handleRunResearch} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <label className="block text-sm font-medium text-slate-300">Procurement Requirement</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
          >
            {loading ? 'Verifying Sources...' : 'Run Deterministic Procurement Pipeline'}
          </button>
        </form>
        {requirement && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-2">Extracted Requirements ({requirement.productType})</h2>
            <p className="text-sm text-slate-300">
              Quantity: {requirement.quantity} | Max Unit Price: {requirement.currency} {requirement.maxUnitPrice ?? 'N/A'} | Evaluations: {evaluations.length}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
