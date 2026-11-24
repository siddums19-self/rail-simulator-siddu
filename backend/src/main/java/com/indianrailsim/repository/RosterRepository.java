package com.indianrailsim.repository;

import com.indianrailsim.model.CustomRoster;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RosterRepository extends JpaRepository<CustomRoster, Long> {
}
