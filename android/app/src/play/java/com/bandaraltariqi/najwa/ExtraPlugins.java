// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import com.getcapacitor.Plugin;

import java.util.Collections;
import java.util.List;

/**
 * The Google Play build: Play updates it, so it has no updater (no
 * UpdatePlugin, no permission to install apps). The GitHub build's
 * ExtraPlugins (src/github) adds it. See build.gradle (najwaStore).
 */
final class ExtraPlugins {
    private ExtraPlugins() {}

    static List<Class<? extends Plugin>> list() {
        return Collections.emptyList();
    }
}
