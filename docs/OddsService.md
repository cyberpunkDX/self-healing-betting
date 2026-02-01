Odds Service Architecture
1. Data Storage (In-Memory)

oddsStore (Map)          oddsHistory (Map)
┌─────────────────┐      ┌─────────────────────────────┐
│ selectionId →   │      │ selectionId → [             │
│   {             │      │   { odds, timestamp, reason }│
│     odds        │      │   { odds, timestamp, reason }│
│     previousOdds│      │   ...                        │
│     marketId    │      │ ]                            │
│     eventId     │      └─────────────────────────────┘
│     status      │
│     lastUpdate  │
│   }             │
└─────────────────┘
2. Lifecycle Flow

┌─────────────────────────────────────────────────────────────┐
│                      SERVICE STARTUP                         │
├─────────────────────────────────────────────────────────────┤
│  1. created()     → Initialize empty Maps                   │
│  2. started()     → Wait 2s, then syncOddsFromEvents()      │
│                   → Start simulation timer (dev only)       │
│  3. stopped()     → Clear simulation timer                  │
└─────────────────────────────────────────────────────────────┘
syncOddsFromEvents() (line 340-364):

Calls event.upcoming and event.live to get all events
Iterates through events → markets → selections
Calls initializeOdds() for each selection
3. Core Methods
initializeOdds() (line 178-190):


// Creates entry in oddsStore
{
  odds: 2.50,
  previousOdds: 2.50,    // Same as odds initially
  marketId: "...",
  eventId: "...",
  status: "active",
  lastUpdate: Date,
  createdAt: Date
}

// Creates first history entry
[{ odds: 2.50, timestamp: Date, reason: "initial" }]
updateOdds() (line 195-235):


┌─────────────────────────────────────────────────────────┐
│  updateOdds(selectionId, newOdds, reason)               │
├─────────────────────────────────────────────────────────┤
│  1. Validate odds exists                                │
│  2. Check range (1.01 - 1000)                           │
│  3. Store previousOdds = current odds                   │
│  4. Update odds = newOdds                               │
│  5. Add to history (max 100 entries)                    │
│  6. Emit "odds.updated" event                           │
│  7. Broadcast to all services (event-service listens)   │
└─────────────────────────────────────────────────────────┘
4. Odds Validation for Bets
validateOdds() (line 283-306):

When bet-service wants to place a bet, it calls this to verify odds haven't moved too much:


// Example: User saw odds of 2.50, tolerance 5%
validateOdds(selectionId, 2.50, 0.05)

// If current odds = 2.60
// difference = |2.60 - 2.50| / 2.50 = 0.04 (4%)
// 4% < 5% tolerance → VALID

// If current odds = 2.70  
// difference = |2.70 - 2.50| / 2.50 = 0.08 (8%)
// 8% > 5% tolerance → INVALID (odds changed)
Returns:


// Valid
{ valid: true, currentOdds: 2.60 }

// Invalid - odds moved
{ valid: false, reason: "Odds have changed", expectedOdds: 2.50, currentOdds: 2.70, difference: "8.00%" }

// Invalid - suspended
{ valid: false, reason: "Odds are suspended", status: "suspended" }
5. Accumulator Calculation
calculateAccumulatorOdds() (line 311-337):


Selection A: 2.00
Selection B: 1.50
Selection C: 3.00
─────────────────
Combined:    2.00 × 1.50 × 3.00 = 9.00
Returns:


{
  selections: [
    { selectionId: "A", odds: 2.00 },
    { selectionId: "B", odds: 1.50 },
    { selectionId: "C", odds: 3.00 }
  ],
  combinedOdds: 9.00,
  selectionCount: 3
}
6. Event Handling

┌──────────────────────────────────────────────────────────────┐
│                    INCOMING EVENTS                            │
├──────────────────────────────────────────────────────────────┤
│  "market.statusChanged"                                       │
│    └─→ status=suspended → suspendMarketOdds(marketId)        │
│    └─→ status=open      → resumeMarketOdds(marketId)         │
│                                                               │
│  "event.statusChanged"                                        │
│    └─→ newStatus=live      → handleEventGoLive() (prep live) │
│    └─→ newStatus=suspended → suspendEventOdds()              │
│    └─→ newStatus=finished  → suspendEventOdds()              │
├──────────────────────────────────────────────────────────────┤
│                    OUTGOING EVENTS                            │
├──────────────────────────────────────────────────────────────┤
│  "odds.updated"    → { selectionId, odds, previousOdds, ... }│
│  "odds.suspended"  → { selectionId, reason }                 │
│  "odds.resumed"    → { selectionId }                         │
└──────────────────────────────────────────────────────────────┘
7. Development Simulation
simulateOddsMovement() (line 348-365):

In development mode, odds randomly fluctuate:


Every 5 seconds (configurable):
  For each active selection:
    1. Generate random movement (-10% to +10%)
    2. Apply to current odds
    3. Clamp to valid range (1.01 - 1000)
    4. Round to 2 decimal places
    5. Call updateOdds() if changed
8. Movement Indicator
calculateMovement() (line 339-342):


current=2.50, previous=2.40 → "up"    (odds drifted out)
current=2.30, previous=2.40 → "down"  (odds shortened)
current=2.40, previous=2.40 → "stable"
9. Integration with Other Services

┌─────────────┐     validate()      ┌─────────────┐
│ bet-service │────────────────────→│ odds-service│
│             │←────────────────────│             │
│             │   {valid, odds}     │             │
└─────────────┘                     └─────────────┘
       │                                   ↑
       │ placeBet                          │ odds.updated
       ↓                                   │
┌─────────────┐                     ┌─────────────┐
│   wallet    │                     │event-service│
│   service   │                     │ (updates    │
└─────────────┘                     │  selection) │
                                    └─────────────┘