#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

// Decision: .agents/notes/implemented/architecture/2026-11-03-ios-background-grace.md
@interface SolveBackground : RCTEventEmitter <RCTBridgeModule>
@end
@implementation SolveBackground {
  NSMutableSet<NSString *> *_runs;
  UIBackgroundTaskIdentifier _lease;
  dispatch_block_t _deadline;
  dispatch_block_t _cleanup;
  BOOL _expiring;
}
RCT_EXPORT_MODULE(SolveBackground)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"solveBackgroundExpired", @"solvePhaseTimeout"]; }
- (instancetype)init {
  if ((self = [super init])) {
    _runs = [NSMutableSet set]; _lease = UIBackgroundTaskInvalid;
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(enteredBackground) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(enteredForeground) name:UIApplicationWillEnterForegroundNotification object:nil];
  }
  return self;
}
- (void)endLease {
  if (_deadline) { dispatch_block_cancel(_deadline); _deadline = nil; }
  if (_cleanup) { dispatch_block_cancel(_cleanup); _cleanup = nil; }
  if (_lease != UIBackgroundTaskInvalid) { [[UIApplication sharedApplication] endBackgroundTask:_lease]; _lease = UIBackgroundTaskInvalid; }
}
- (void)expire {
  if (_lease == UIBackgroundTaskInvalid || _expiring) return;
  _expiring = YES;
  if (_runs.count) [self sendEventWithName:@"solveBackgroundExpired" body:@{@"runIds": [_runs allObjects]}];
  __weak SolveBackground *weakSelf = self;
  _cleanup = dispatch_block_create(0, ^{ [weakSelf endLease]; });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), _cleanup);
}
- (void)enteredBackground {
  if (_lease == UIBackgroundTaskInvalid || _expiring) return;
  if (_deadline) { dispatch_block_cancel(_deadline); _deadline = nil; }
  NSTimeInterval remaining = [UIApplication sharedApplication].backgroundTimeRemaining;
  NSTimeInterval grace = MAX(0, MIN(20, remaining - 5));
  __weak SolveBackground *weakSelf = self;
  _deadline = dispatch_block_create(0, ^{ [weakSelf expire]; });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(grace * NSEC_PER_SEC)), dispatch_get_main_queue(), _deadline);
}
- (void)enteredForeground {
  if (_deadline) { dispatch_block_cancel(_deadline); _deadline = nil; }
}
RCT_REMAP_METHOD(start, startRun:(NSString *)runId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!_expiring && [_runs containsObject:runId]) { resolve(nil); return; }
  if (_expiring || _runs.count >= __SOLVEFLOW_MAX_JOBS__) { reject(@"BACKGROUND_UNAVAILABLE", @"Background execution is unavailable", nil); return; }
  if (_lease == UIBackgroundTaskInvalid) {
    __weak SolveBackground *weakSelf = self;
    _lease = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"SolveFlow finish accepted answers" expirationHandler:^{
      [weakSelf expire]; [weakSelf endLease];
    }];
    if (_lease == UIBackgroundTaskInvalid) { reject(@"BACKGROUND_UNAVAILABLE", @"Background execution is unavailable", nil); return; }
  }
  [_runs addObject:runId]; resolve(nil);
  if ([UIApplication sharedApplication].applicationState == UIApplicationStateBackground && !_deadline) [self enteredBackground];
}
RCT_REMAP_METHOD(stop, stopRun:(NSString *)runId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [_runs removeObject:runId]; if (_runs.count == 0) { [self endLease]; _expiring = NO; } resolve(nil);
}
RCT_EXPORT_METHOD(armTimer:(nonnull NSNumber *)identifier ms:(nonnull NSNumber *)ms) {}
RCT_EXPORT_METHOD(cancelTimer:(nonnull NSNumber *)identifier) {}
RCT_EXPORT_METHOD(diagnostic:(NSString *)entry) {}
- (void)invalidate { [[NSNotificationCenter defaultCenter] removeObserver:self]; if ([NSThread isMainThread]) [self endLease]; else dispatch_async(dispatch_get_main_queue(), ^{ [self endLease]; }); [super invalidate]; }
@end
