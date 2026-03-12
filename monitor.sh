#!/bin/bash
# Amtrak Train 194 Monitor
# Runs track-train.js at intervals, adjusting frequency based on phase
# Logs output to monitor.log

LOG_FILE="/home/user/Amtrak/monitor.log"
STATE_FILE="/home/user/Amtrak/tracker-state.json"
INTERVAL=900  # 15 minutes in seconds (default)

echo "Starting Amtrak Train 194 monitor at $(date)" | tee -a "$LOG_FILE"

while true; do
    echo "--- Check at $(date) ---" | tee -a "$LOG_FILE"
    node /home/user/Amtrak/track-train.js 2>&1 | tee -a "$LOG_FILE"

    # Read phase from state file to adjust interval
    if [ -f "$STATE_FILE" ]; then
        PHASE=$(node -e "try { const s = require('$STATE_FILE'); console.log(s.phase || 'pre-nyp'); } catch(e) { console.log('pre-nyp'); }")
        ARRIVED=$(node -e "try { const s = require('$STATE_FILE'); console.log(s.trainArrived || false); } catch(e) { console.log('false'); }")

        if [ "$ARRIVED" = "true" ]; then
            echo "Train has arrived at PVD. Stopping monitor." | tee -a "$LOG_FILE"
            break
        fi

        case "$PHASE" in
            approaching-nyp|at-nyp)
                INTERVAL=120  # 2 minutes
                echo "Phase: $PHASE - polling every 2 minutes" | tee -a "$LOG_FILE"
                ;;
            *)
                INTERVAL=900  # 15 minutes
                echo "Phase: $PHASE - polling every 15 minutes" | tee -a "$LOG_FILE"
                ;;
        esac
    fi

    sleep $INTERVAL
done

echo "Monitor stopped at $(date)" | tee -a "$LOG_FILE"
