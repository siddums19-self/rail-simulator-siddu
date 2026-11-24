# Indian Rail Sim — Feature Roadmap

Ideas to make the simulator more exciting, in suggested build order.
Status: `[ ]` planned · `[~]` in progress · `[x]` done.

**Recommended first:** 1, 2 and 3. They reuse what already exists (timetable,
signals, traffic, physics) and add the most tension per hour of work.

---

## 1. Run to the timetable `[ ]`
Make punctuality the goal of every run.
- Score on arrival time at each halt: on-time bonus, lateness penalty.
- Penalty for leaving early (before the scheduled departure).
- Bonus for recovering lost time without overspeeding.
- End-of-run report: arrival and departure time per halt against the schedule.
- *Builds on:* the existing Late/Ahead counter, the timetable and the scorer.

## 2. Breakdowns & incidents `[ ]`
Random events, each with a real procedure to follow.
- **Cattle run-over:** stop, inspect, report, continue.
- **Hot axle** reported by a station: stop at the next station for examination.
- **Overhead wire (OHE) fault:** lower the pantograph and coast through the dead section.
- **Signal failure:** stop at the failed signal and take written authority (T/369(3b)) to pass it at 15 km/h.
- **Level-crossing gate left open:** hold at the gate signal until it is closed.
- *Builds on:* signals, Kavach, the level crossings and the toast/announcement system.

## 3. Goods train mode `[ ]`
A completely different driving skill.
- 58-wagon BOXN rake with long braking distances and slow brake-pipe propagation.
- Multiple locos coupled together (WAG-9 ×2).
- Gradients matter: stalling on banks, controlling speed on down grades.
- Looped at stations so passenger trains can overtake (precedence from the other side).
- *Builds on:* rakes/consist, the physics and the precedence logic.

## 4. Weather & season `[ ]`
- **Monsoon:** washouts and temporary speed restrictions, notified by caution orders before departure.
- **Fog:** a fog safety device that beeps and shows distance to the next signal; reduced line speeds.
- **Summer:** heat-related track speed restrictions.
- *Builds on:* the sky/weather presets, the fog dome and the speed-limit system.

## 5. Shunting & engine change `[ ]`
A short, skill-based mini-game at terminals and junctions.
- At Guntakal or Secunderabad: detach the loco, run round the train, couple at the other end.
- Coupling must be under 5 km/h, or a jolt penalty applies.
- Ground shunt signals and a shunting speed limit.
- *Builds on:* reversal stations (`st.reversal`, `engineChanged`) and `replaceLead`.

## 6. Career mode `[~]`
- [x] Email login / sign-up / continue as guest; career saved to the account (guest progress not saved).
- [x] Ranks by XP, km driven, runs, on-time arrivals, SPADs, incidents, best score, last 12 runs.
- Progress: Assistant Loco Pilot (DEMU) → Goods → Mail/Express → Rajdhani → Vande Bharat.
- Unlock routes and locos with scores.
- Persistent profile: hours, km driven, SPADs, punctuality record.

## 7. Challenge scenarios `[ ]`
Hand-made one-off missions, for example:
- "Late by 40 min — recover time without a single overspeed."
- "Kavach off, dense fog, night run."
- "Single-line crossing at Dhone with 3 opposing trains."
- "Pass a failed signal correctly."

## 8. Passengers & ride comfort `[ ]`
- Passenger complaints for jerky braking or harsh starts.
- "Smooth driver" rating.
- Alarm-chain-pull event: stop, the guard resets it, continue.
- *Builds on:* the existing comfort percentage in the HUD.

## 9. Free-roam / photographer mode `[ ]`
- Pause the simulation and fly the camera freely.
- Follow any AI train.
- Cinematic auto-switching trackside cameras.
- Photo mode with depth of field.

## 10. Dispatcher mode `[ ]`
- Run the Guntakal panel instead of driving.
- Set routes, clear signals and juggle the traffic.
- Score on delays caused and conflicts avoided.

## 11. Leaderboards & replays `[ ]`
- Daily challenge: the same seed for everyone.
- Replays saved from the existing Recorder.
- Leaderboard on the backend (score, punctuality, SPADs).

---

## Smaller polish items
- [ ] Short shelters / small huts instead of full-length platform roofs at village halts.
- [ ] Exact station building models (`.glb` drop-ins via `public/models/stations/manifest.json`).
- [ ] Verify Cloud Text-to-Speech end-to-end once the API is enabled on `railsimulator-190291`.
