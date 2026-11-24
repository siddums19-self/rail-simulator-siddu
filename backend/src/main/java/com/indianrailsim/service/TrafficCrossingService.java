package com.indianrailsim.service;

import com.indianrailsim.service.RoutePathfinderService.SolvedLeg;
import com.indianrailsim.service.RoutePathfinderService.SolvedRoute;
import com.indianrailsim.service.RoutePathfinderService.StationNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class TrafficCrossingService {

    public record CrossingEvent(
        String legEdgeId, String stationCode, String eventType,
        String oncomingTrainName, String oncomingLoco, String oncomingRake,
        int waitSeconds, String homeSignalAspect, boolean routeFeatherLit, int loopSpeedLimitKmph
    ) {}

    public List<CrossingEvent> generateCrossings(SolvedRoute route) {
        List<CrossingEvent> events = new ArrayList<>();
        String[][] aiPool = {
            {"20704 Vande Bharat Express", "VB-EMU", "VANDE_BHARAT"},
            {"12793 Rayalaseema SF Express", "WAP-7", "LHB"},
            {"BOXN 58-Wagon Coal Freight", "WAG-12B", "BOXN_GOODS"},
            {"BCN Container Freight Special", "WAG-9", "BOXN_GOODS"},
            {"12798 Venkatadri Express", "WAP-7", "LHB"},
            {"77414 GTL-KRNT DEMU Passenger", "DEMU-1400HP", "DEMU_PASSENGER"}
        };
        int idx = 0;

        for (SolvedLeg leg : route.legs()) {
            boolean isSingle = leg.trackType().contains("SINGLE");
            for (int i = 1; i < leg.stations().size() - 1; i++) {
                StationNode st = leg.stations().get(i);
                String[] ai = aiPool[idx++ % aiPool.length];
                if (isSingle && (i % 2 == 1)) {
                    events.add(new CrossingEvent(
                        leg.edgeId(), st.code(), "SINGLE_LINE_LOOP_WAIT",
                        ai[0], ai[1], ai[2], 18, "YELLOW_CAUTION", true, 30
                    ));
                } else if (!isSingle && (i % 2 == 0)) {
                    events.add(new CrossingEvent(
                        leg.edgeId(), st.code(), "DOUBLE_LINE_PASS",
                        ai[0], ai[1], ai[2], 0, "GREEN_PROCEED", false, 130
                    ));
                }
            }
        }
        return events;
    }
}
