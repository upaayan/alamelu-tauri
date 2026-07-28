#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>

typedef void (*AlameluNotificationCallback)(const char *identifier);
typedef void (*AlameluPermissionCallback)(NSInteger status, const char *error,
                                          void *context);

@interface AlameluNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, assign) AlameluNotificationCallback callback;
@end

@implementation AlameluNotificationDelegate

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:
             (void (^)(UNNotificationPresentationOptions options))completionHandler {
  completionHandler(UNNotificationPresentationOptionBanner |
                    UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  NSString *identifier = response.notification.request.identifier;
  if (self.callback != NULL && identifier != nil) {
    self.callback(identifier.UTF8String);
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSApp activateIgnoringOtherApps:YES];
  });
  completionHandler();
}

@end

static AlameluNotificationDelegate *alameluDelegate;

static NSInteger alamelu_permission_status(UNAuthorizationStatus status) {
  switch (status) {
  case UNAuthorizationStatusDenied:
    return 1;
  case UNAuthorizationStatusAuthorized:
  case UNAuthorizationStatusProvisional:
    return 2;
  case UNAuthorizationStatusNotDetermined:
  default:
    return 0;
  }
}

static void alamelu_complete_permission_status(
    UNUserNotificationCenter *center, AlameluPermissionCallback callback,
    void *context) {
  [center
      getNotificationSettingsWithCompletionHandler:^(
          UNNotificationSettings *settings) {
        callback(alamelu_permission_status(settings.authorizationStatus), NULL,
                 context);
      }];
}

void alamelu_notifications_init(AlameluNotificationCallback callback) {
  dispatch_async(dispatch_get_main_queue(), ^{
    alameluDelegate = [[AlameluNotificationDelegate alloc] init];
    alameluDelegate.callback = callback;
    [UNUserNotificationCenter currentNotificationCenter].delegate = alameluDelegate;
  });
}

void alamelu_notification_permission_status(AlameluPermissionCallback callback,
                                            void *context) {
  if (callback == NULL) {
    return;
  }
  alamelu_complete_permission_status(
      [UNUserNotificationCenter currentNotificationCenter], callback, context);
}

void alamelu_notification_request_permission(AlameluPermissionCallback callback,
                                             void *context) {
  if (callback == NULL) {
    return;
  }
  UNUserNotificationCenter *center =
      [UNUserNotificationCenter currentNotificationCenter];
  [center
      requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                       UNAuthorizationOptionBadge |
                                       UNAuthorizationOptionSound)
                    completionHandler:^(BOOL granted, NSError *error) {
                      (void)granted;
                      if (error != nil) {
                        callback(-1, error.localizedDescription.UTF8String,
                                 context);
                        return;
                      }
                      alamelu_complete_permission_status(center, callback,
                                                         context);
                    }];
}

void alamelu_notification_show(const char *identifier, const char *title,
                               const char *body) {
  NSString *notificationIdentifier =
      [NSString stringWithUTF8String:identifier ?: "alamelu-notification"];
  NSString *notificationTitle =
      [NSString stringWithUTF8String:title ?: "Alamelu Pi"];
  NSString *notificationBody = [NSString stringWithUTF8String:body ?: ""];
  dispatch_async(dispatch_get_main_queue(), ^{
    UNMutableNotificationContent *content =
        [[UNMutableNotificationContent alloc] init];
    content.title = notificationTitle;
    content.body = notificationBody;
    content.sound = [UNNotificationSound defaultSound];
    UNNotificationRequest *request = [UNNotificationRequest
        requestWithIdentifier:notificationIdentifier
                      content:content
                      trigger:nil];
    [[UNUserNotificationCenter currentNotificationCenter]
        addNotificationRequest:request
         withCompletionHandler:nil];
  });
}
