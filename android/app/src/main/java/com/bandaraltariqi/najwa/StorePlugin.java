// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web layer which store this build was made for: "play" for the
 * Google Play build (NAJWA_STORE=play when it is built, see build.gradle),
 * an empty string for every other build.
 */
@CapacitorPlugin(name = "Store")
public class StorePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        out.put("store", BuildConfig.NAJWA_STORE);
        call.resolve(out);
    }
}
