package com.indianrailsim.model;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "custom_rosters")
public class CustomRoster {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "train_number", nullable = false)
    public String trainNumber;

    @Column(name = "train_name", nullable = false)
    public String trainName;

    @Column(name = "priority_tier", nullable = false)
    public String priorityTier;

    @Column(name = "coach_type", nullable = false)
    public String coachType;

    @Column(name = "loco_class", nullable = false)
    public String locoClass;

    @Column(name = "source_code", nullable = false)
    public String sourceCode;

    @Column(name = "dest_code", nullable = false)
    public String destCode;

    @Column(name = "via_codes_csv")
    public String viaCodesCsv;

    @Column(name = "halts_csv", nullable = false)
    public String haltsCsv;

    @Column(name = "loco_swap_hub")
    public String locoSwapHub;

    @Column(name = "swap_to_loco_class")
    public String swapToLocoClass;

    @Column(name = "created_at")
    public OffsetDateTime createdAt = OffsetDateTime.now();
}
