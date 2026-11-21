/**
 * GhostRun v3.0 Tactical Audio Generator
 * Synthesizes 16-bit 44.1kHz mono PCM WAV files for mobile loudspeakers.
 */

import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;

function createWavBuffer(samples: Float32Array): Buffer {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // audio format (1 = PCM)
  buffer.writeUInt16LE(1, 22);  // num channels (1 = mono)
  buffer.writeUInt32LE(SAMPLE_RATE, 24); // sample rate
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(2, 32);  // block align (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  // Write samples with soft clipping
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intVal = s < 0 ? Math.floor(s * 32768) : Math.min(32767, Math.floor(s * 32767));
    buffer.writeInt16LE(intVal, 44 + i * 2);
  }

  return buffer;
}

function generateHeartbeatSlow(): Float32Array {
  const durationS = 1.0;
  const samples = new Float32Array(SAMPLE_RATE * durationS);

  // Lub at 0.0s, Dub at 0.22s
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    let amp = 0;

    // Lub (0.0 to 0.16s)
    if (t >= 0 && t < 0.16) {
      const env = Math.sin((t / 0.16) * Math.PI);
      amp += 0.85 * env * Math.sin(2 * Math.PI * 55 * t);
      amp += 0.35 * env * Math.sin(2 * Math.PI * 110 * t);
    }

    // Dub (0.22 to 0.40s)
    if (t >= 0.22 && t < 0.40) {
      const dt = t - 0.22;
      const env = Math.sin((dt / 0.18) * Math.PI);
      amp += 0.70 * env * Math.sin(2 * Math.PI * 48 * dt);
      amp += 0.25 * env * Math.sin(2 * Math.PI * 96 * dt);
    }

    samples[i] = amp;
  }
  return samples;
}

function generateHeartbeatFast(): Float32Array {
  const durationS = 0.50;
  const samples = new Float32Array(SAMPLE_RATE * durationS);

  // Fast adrenaline Lub at 0.0s, Dub at 0.14s
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    let amp = 0;

    // Lub (0.0 to 0.12s)
    if (t >= 0 && t < 0.12) {
      const env = Math.sin((t / 0.12) * Math.PI);
      amp += 0.90 * env * Math.sin(2 * Math.PI * 68 * t);
      amp += 0.40 * env * Math.sin(2 * Math.PI * 136 * t);
    }

    // Dub (0.14 to 0.26s)
    if (t >= 0.14 && t < 0.26) {
      const dt = t - 0.14;
      const env = Math.sin((dt / 0.12) * Math.PI);
      amp += 0.75 * env * Math.sin(2 * Math.PI * 60 * dt);
      amp += 0.30 * env * Math.sin(2 * Math.PI * 120 * dt);
    }

    samples[i] = amp;
  }
  return samples;
}

function generateAlarmDanger(): Float32Array {
  const durationS = 0.75;
  const samples = new Float32Array(SAMPLE_RATE * durationS);

  // Triple high-urgency chirps (880Hz, 1175Hz, 1480Hz)
  const beeps = [
    { start: 0.0, dur: 0.10, freq: 880 },
    { start: 0.14, dur: 0.10, freq: 1175 },
    { start: 0.28, dur: 0.16, freq: 1480 },
  ];

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    let amp = 0;

    for (const b of beeps) {
      if (t >= b.start && t < b.start + b.dur) {
        const dt = t - b.start;
        const env = Math.sin((dt / b.dur) * Math.PI);
        // Mix fundamental + subtle square distortion for loudspeaker punch
        const sine = Math.sin(2 * Math.PI * b.freq * dt);
        const harm = Math.sin(2 * Math.PI * (b.freq * 2) * dt);
        amp += 0.8 * env * (0.8 * sine + 0.2 * harm);
      }
    }

    samples[i] = amp;
  }
  return samples;
}

function generateSirenRelease(): Float32Array {
  const durationS = 2.2;
  const samples = new Float32Array(SAMPLE_RATE * durationS);

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    // Rising horn sweep from 180Hz to 480Hz with stereo airhorn resonance
    const env = t < 0.15
      ? t / 0.15
      : t > 1.8
        ? Math.max(0, (2.2 - t) / 0.4)
        : 1.0;

    const freq = 180 + 300 * Math.min(1.0, t / 1.5);
    const wave1 = Math.sin(2 * Math.PI * freq * t);
    const wave2 = Math.sin(2 * Math.PI * (freq * 1.5) * t); // perfect fifth overtone
    const wave3 = Math.sin(2 * Math.PI * (freq * 2) * t);   // octave

    samples[i] = env * (0.55 * wave1 + 0.30 * wave2 + 0.15 * wave3);
  }
  return samples;
}

function generateInfectionScreech(): Float32Array {
  const durationS = 1.4;
  const samples = new Float32Array(SAMPLE_RATE * durationS);

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = t < 0.05
      ? t / 0.05
      : Math.exp(-3.0 * (t - 0.05));

    // Downward pitch bend with heavy FM modulation (screech -> groan)
    const baseFreq = 1600 * Math.exp(-2.5 * t) + 80;
    const modFreq = 180 * Math.exp(-1.5 * t);
    const modIndex = 4.0 * Math.exp(-2.0 * t);

    const fm = Math.sin(2 * Math.PI * baseFreq * t + modIndex * Math.sin(2 * Math.PI * modFreq * t));
    const subImpact = t < 0.4 ? Math.sin((t / 0.4) * Math.PI) * Math.sin(2 * Math.PI * 50 * t) : 0;

    samples[i] = 0.75 * env * fm + 0.4 * subImpact;
  }
  return samples;
}

// Generate all sound files into assets/sounds/
const outputDir = path.resolve(__dirname, '../assets/sounds');

const filesToGenerate: Array<{ name: string; gen: () => Float32Array }> = [
  { name: 'heartbeat_slow.wav', gen: generateHeartbeatSlow },
  { name: 'heartbeat_fast.wav', gen: generateHeartbeatFast },
  { name: 'alarm_danger.wav', gen: generateAlarmDanger },
  { name: 'siren_release.wav', gen: generateSirenRelease },
  { name: 'infection_screech.wav', gen: generateInfectionScreech },
];

for (const f of filesToGenerate) {
  const filePath = path.join(outputDir, f.name);
  const samples = f.gen();
  const buffer = createWavBuffer(samples);
  fs.writeFileSync(filePath, buffer);
  console.log(`Generated: ${f.name} (${buffer.length} bytes, ${(samples.length / SAMPLE_RATE).toFixed(2)}s)`);
}

console.log('Tactical Audio assets generated successfully.');
