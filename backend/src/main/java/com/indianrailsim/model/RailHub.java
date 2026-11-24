package com.indianrailsim.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "rail_hubs")
public class RailHub {
    @Id
    public String code;
    public String name;
    public int platforms;

    @Column(name = "loco_change_allowed")
    public boolean locoChangeAllowed;

    @Column(name = "mandatory_reversal")
    public boolean mandatoryReversal;

    public double lat;
    public double lon;
}
