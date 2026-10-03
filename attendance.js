const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = { 'Content-Type': 'application/json' };

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === 'object' ? (data.message || data.error || JSON.stringify(data)) : String(data));
  return data;
}

exports.handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'Supabase environment variables are missing in Netlify.' });
    const method = event.httpMethod;

    if (method === 'GET') {
      const date = event.queryStringParameters?.date;
      if (!date) return json(400, { error: 'date is required' });
      const attendance = await sb(`attendance?attendance_date=eq.${encodeURIComponent(date)}&select=attendance_date,team_id,employee_id,status,marked_by`);
      const submissions = await sb(`attendance_submissions?attendance_date=eq.${encodeURIComponent(date)}&select=attendance_date,team_id,submitted_by,submitted_at`);
      return json(200, { attendance, submissions });
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { attendance_date, team_name, submitted_by, records } = body;
      if (!attendance_date || !team_name || !Array.isArray(records)) return json(400, { error: 'attendance_date, team_name and records are required' });

      const teams = await sb(`teams?team_name=eq.${encodeURIComponent(team_name)}&select=id,team_name&limit=1`);
      if (!teams?.length) return json(404, { error: `Team not found: ${team_name}` });
      const team_id = teams[0].id;

      const rows = records.map(x => ({
        attendance_date,
        team_id,
        employee_id: String(x.employee_id),
        status: String(x.status),
        marked_by: submitted_by ? String(submitted_by) : null
      }));

      if (rows.length) {
        await sb('attendance?on_conflict=attendance_date,team_id,employee_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows)
        });
      }

      await sb('attendance_submissions?on_conflict=attendance_date,team_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ attendance_date, team_id, submitted_by: String(submitted_by || '') }])
      });

      return json(200, { ok: true, team_id, count: rows.length });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    return json(500, { error: e.message || 'Server error' });
  }
};
