// @@@LICENSE
//
//      Copyright (c) 2010-2013 LG Electronics, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

// Phoenix compat overlay: the original list, and data/phoenix-temperature.js
// after PowerdService.js (the battery's temperature warnings,
// docs/M6-PLAN.md F4 item 9).

enyo.depends(
		"data/AppManagerService.js",
		"data/SystemManagerService.js",
		"data/PowerdService.js",
		"data/phoenix-temperature.js",
		"data/StoragedService.js",
		"data/TelephonyService.js",
		"data/System-Service.js",
		"data/SysUpdateService.js",
		"utils/utils.js",
		"app/SystemUIApp.js",
		"$enyo-lib/networkalerts/",
		"$enyo-lib/syncui/"
);
