// Phoenix compat: the cycling new-email dashboard (docs/M6-PLAN.md F4; the
// community's "Uber Cycling Email Dashboard" / "Cycling Email
// Notifications" / "Delete Email from Dashboard" patches, 60RH, 2013).
//
// With Settings > Advanced > Cycling email dashboard on (the system
// preference emailDashboardCycling; off, as the patches were optional),
// DashboardManager's new-email dashboards are PhoenixCyclingDashboard: the
// same enyo.Dashboard and layers, shown by phoenix-dashboard/cycling.html,
// which goes through the new emails one at a time, newest first, each with
// its time, and has a button that deletes the one shown (Email.deleteEmails,
// as deleting it in the inbox does). Error dashboards are unchanged.

/*global enyo, EmailApp, Email, DashboardManager */
(function () {
    "use strict";

    enyo.kind({
        name: "PhoenixCyclingDashboard",
        kind: "enyo.Dashboard",
        indexPath: "/usr/palm/applications/com.palm.app.email/phoenix-dashboard/cycling.html",
        events: {
            /** The window's delete button: the layer of the email to delete. */
            onDeleteEmail: ""
        }
    });

    var proto = DashboardManager.prototype;
    var create = proto.create, updateDashboard = proto._updateDashboard;

    proto.create = function () {
        create.apply(this, arguments);
        this.phoenixCycling = false;
        var that = this;
        EmailApp.Util.callService("palm://com.palm.systemservice/getPreferences",
            {keys: ["emailDashboardCycling"], subscribe: true}, function (r) {
                if (r && r.emailDashboardCycling !== undefined) {
                    that.phoenixCycling = !!r.emailDashboardCycling;
                }
            });
    };

    // A new dashboard for the account: the cycling one when it is on.
    proto._updateDashboard = function (accountId, messages) {
        if (this.phoenixCycling && !this.dashboards[accountId] && messages.length > 0) {
            this.dashboards[accountId] = this.createComponent({
                name: "dashboard-" + accountId,
                kind: "PhoenixCyclingDashboard",
                accountId: accountId,
                onDashboardActivated: "dashboardActivated",
                onDashboardDeactivated: "dashboardDeactivated",
                onIconTap: "dashboardIconTap",
                onMessageTap: "dashboardMessageTap",
                onUserClose: "userCloseHandler",
                onLayerSwipe: "layerSwipeHandler",
                onDeleteEmail: "phoenixDeleteEmail",
                smallIcon: "images/notification-small.png"
            });
        }
        return updateDashboard.apply(this, arguments);
    };

    proto.phoenixDeleteEmail = function (inSender, layer) {
        if (!layer || !layer.emailId) {
            return;
        }
        Email.deleteEmails({id: layer.emailId}, null);
        this.clear(layer.accountId, null, layer.emailId);
    };
}());
