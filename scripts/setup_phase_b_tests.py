import psycopg2
import json

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

# 1. Setup ZQHA (Outbreak Horde / Tactical Objectives / Proximity Threat)
zqha_id = '47c3b4f0-271f-4588-9d65-ba7236b5e4e0'
hunter_pid = 'ec9bb6c9-82f8-4591-8079-ad95eec38015'
runner_pid = '8294d45b-6881-463e-80b6-fafe5bdd14af'

cur.execute("""
    UPDATE games 
    SET status = 'live',
        live_at = clock_timestamp() - interval '25 seconds',
        ends_at = clock_timestamp() + interval '10 minutes',
        mode_params = jsonb_build_object(
            'difficulty', 'standard',
            'jail', jsonb_build_object('latitude', 19.1622, 'longitude', 72.8423),
            'extraction', jsonb_build_object('latitude', 19.1616, 'longitude', 72.8438),
            'outbreak_horde', jsonb_build_object(
                'initial_health_s', 360,
                'antidote_boost_hp', 65,
                'drift_velocity_mps', 0.6
            )
        )
    WHERE id = %s
""", (zqha_id,))

# Set player positions for 18m proximity (triggers threat vignette < 25m)
cur.execute("""
    INSERT INTO player_positions (player_id, game_id, geog, recorded_at, updated_at)
    VALUES 
        (%s, %s, ST_SetSRID(ST_MakePoint(72.84230, 19.16010), 4326)::geography, clock_timestamp(), clock_timestamp()),
        (%s, %s, ST_SetSRID(ST_MakePoint(72.84230, 19.16026), 4326)::geography, clock_timestamp(), clock_timestamp())
    ON CONFLICT (player_id) DO UPDATE 
    SET geog = EXCLUDED.geog, recorded_at = clock_timestamp(), updated_at = clock_timestamp(), game_id = EXCLUDED.game_id
""", (hunter_pid, zqha_id, runner_pid, zqha_id))

# Insert a radar ping (140m away)
cur.execute("""
    INSERT INTO pings (game_id, seq, player_id, geog, accuracy_m, released_at)
    VALUES (%s, 1, %s, ST_SetSRID(ST_MakePoint(72.8415, 19.1612), 4326)::geography, 8, clock_timestamp())
    ON CONFLICT DO NOTHING
""", (zqha_id, runner_pid))

# 2. Setup RSWU (Territory Pulse with 3 Runners, 1 Contested, 3 Hunters)
rswu_id = '26fe8f48-a331-460f-ad27-a991f08643cf'

cur.execute("""
    UPDATE games
    SET status = 'live',
        live_at = clock_timestamp() - interval '20 seconds',
        ends_at = clock_timestamp() + interval '10 minutes',
        mode_params = jsonb_set(
            coalesce(mode_params, '{}'::jsonb),
            '{territory_pulse}',
            jsonb_build_object(
                'pulse_interval_s', 90,
                'dominance_pct', 70,
                'next_pulse_at', (clock_timestamp() + interval '42 seconds'),
                'scores', jsonb_build_object('runner', 3, 'hunter', 3)
            )
        )
    WHERE id = %s
""", (rswu_id,))

# Update the 7 zones: 3 runner, 3 hunter, 1 neutral (contested)
zones_config = [
    ('Core', None),
    ('Alpha', 'runner'),
    ('Bravo', 'runner'),
    ('Echo', 'runner'),
    ('Charlie', 'hunter'),
    ('Delta', 'hunter'),
    ('Foxtrot', 'hunter'),
]

for name, ctrl in zones_config:
    cur.execute("""
        UPDATE entities
        SET state = jsonb_set(
            state,
            '{controller}',
            %s::jsonb
        )
        WHERE game_id = %s AND state->>'name' = %s
    """, (json.dumps(ctrl), rswu_id, name))

conn.commit()
print("Setup complete for ZQHA and RSWU!")
conn.close()
