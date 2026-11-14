import assert from 'node:assert';
import {
  formatTacticalVoiceCue,
  TacticalVoiceQueue,
  NarrationCue,
} from '../src/lib/ttsNarrationCore';

console.log('--- Testing NF-33: Spoken TTS Narration Engine ---');

// Test 1: formatTacticalVoiceCue Templates
{
  const headStart = formatTacticalVoiceCue('head_start_begin', '60 seconds remaining.');
  assert.ok(headStart.includes('Runners, disperse into the zone'));
  assert.ok(headStart.includes('60 seconds remaining'));

  const hunters = formatTacticalVoiceCue('hunters_released');
  assert.ok(hunters.includes('Hunters released'));

  const proximity = formatTacticalVoiceCue('hunter_proximity', '15 meters');
  assert.ok(proximity.includes('Warning: Hunter closing in'));
  assert.ok(proximity.includes('15 meters'));

  const tagged = formatTacticalVoiceCue('player_tagged', 'Runner captured');
  assert.ok(tagged.includes('Target neutralized'));
  console.log('✓ Test 1: formatTacticalVoiceCue produces standard tactical game prompts');
}

// Test 2: TacticalVoiceQueue - FIFO for normal cues
{
  const queue = new TacticalVoiceQueue();
  const c1: NarrationCue = { id: '1', text: 'First', priority: 'normal', createdAt: 1 };
  const c2: NarrationCue = { id: '2', text: 'Second', priority: 'normal', createdAt: 2 };

  queue.enqueue(c1);
  queue.enqueue(c2);

  assert.strictEqual(queue.next()?.id, '1');
  assert.strictEqual(queue.next()?.id, '2');
  assert.strictEqual(queue.next(), undefined);
  console.log('✓ Test 2: TacticalVoiceQueue handles standard cues in FIFO order');
}

// Test 3: TacticalVoiceQueue - High Priority Preemption
{
  const queue = new TacticalVoiceQueue();
  const normal1: NarrationCue = { id: 'n1', text: 'Normal 1', priority: 'normal', createdAt: 1 };
  const normal2: NarrationCue = { id: 'n2', text: 'Normal 2', priority: 'normal', createdAt: 2 };
  const urgent: NarrationCue = { id: 'u1', text: 'Hunter Nearby!', priority: 'high', createdAt: 3 };

  queue.enqueue(normal1);
  queue.enqueue(normal2);
  queue.enqueue(urgent); // Should jump to the front

  assert.strictEqual(queue.next()?.id, 'u1', 'High-priority cue must jump to the front');
  assert.strictEqual(queue.next()?.id, 'n1');
  assert.strictEqual(queue.next()?.id, 'n2');
  console.log('✓ Test 3: High-priority urgent cues preempt normal queue items');
}

// Test 4: TacticalVoiceQueue - Max Queue Length Pruning
{
  const queue = new TacticalVoiceQueue();
  for (let i = 1; i <= 5; i++) {
    queue.enqueue({ id: `c${i}`, text: `Cue ${i}`, priority: 'normal', createdAt: i });
  }

  // Max length is 3, so queue should only have 3 items
  assert.strictEqual(queue.getQueue().length, 3);
  console.log('✓ Test 4: Queue enforces maximum length by pruning stale items');
}

console.log('\nAll 4 NF-33 spoken narration tests passed successfully!\n');
