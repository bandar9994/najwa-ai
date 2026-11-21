// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import com.getcapacitor.Plugin;

import java.util.Collections;
import java.util.List;

/**
 * Plugins only in the GitHub (sideloaded) build: it updates itself
 * (UpdatePlugin). The Google Play build, which Play updates, has its own
 * ExtraPlugins (src/play) with none. See build.gradle (najwaStore).
 */
final class ExtraPlugins {
    private ExtraPlugins() {}

    static List<Class<? extends Plugin>> list() {
        return Collections.singletonList(UpdatePlugin.class);
    }
}
