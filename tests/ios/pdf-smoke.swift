import XCTest

final class SolveFlowPdfTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.solveflow.app")
  override func setUpWithError() throws { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait; app.launch() }
  override func tearDownWithError() throws {
    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-pdf-final"; shot.lifetime = .keepAlways; add(shot)
    let tree = XCTAttachment(string: app.debugDescription); tree.name = "native-pdf-accessibility"; tree.lifetime = .keepAlways; add(tree)
    app.terminate()
  }
  private func control(_ name: String) -> XCUIElement {
    let element = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", name)).firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: 20), "Missing control \(name)")
    return element
  }
  private func capture(_ name: String) { let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot) }
  private func reach(_ element: XCUIElement) {
    let dialog = app.otherElements["native-pdf-dialog"]
    let records = app.otherElements["native-export-records"]
    let scroll = dialog.exists ? dialog.scrollViews.firstMatch : records.exists ? records.scrollViews.firstMatch : app.scrollViews.containing(.any, identifier: element.label).firstMatch
    XCTAssertTrue(scroll.waitForExistence(timeout: 10))
    for _ in 0..<8 {
      if element.exists && element.isHittable { return }
      scroll.swipeUp(velocity: .slow)
    }
    XCTAssertTrue(element.isHittable)
  }
  private func openExport() {
    control("题目").tap(); control("历史题目").tap(); control("批量记录").tap()
    control("批次操作：Native PDF synthetic").tap(); control("导出 PDF").tap()
    XCTAssertTrue(app.otherElements["native-pdf-dialog"].waitForExistence(timeout: 20))
  }
  private func openRecords() {
    control("我的").tap(); let entry = control("导出记录"); reach(entry); entry.tap()
    XCTAssertTrue(app.otherElements["native-export-records"].waitForExistence(timeout: 20))
  }
  private func replace(_ label: String, _ text: String) {
    let field = app.textFields[label]; XCTAssertTrue(field.waitForExistence(timeout: 20)); reach(field); field.tap()
    let count = (field.value as? String ?? "").count
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: count) + text)
  }
  private func completedRecords() -> Int {
    app.otherElements.matching(identifier: "native-export-record-succeeded").count
  }
  func testNativePdfCopiesAndQuestionsSurviveRelaunch() throws {
    openExport()
    replace("导出份数", "2")
    replace("第1份错题数", "1")
    replace("第2份错题数", "2")
    // Drag dismisses the number pad; fixed footer must remain reachable.
    app.swipeDown(velocity: .slow)
    control("标记错题").tap()
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(control("关闭导出").isHittable)
    XCTAssertTrue(control("生成 PDF 压缩包").isHittable)
    capture("01-native-pdf-landscape")
    XCUIDevice.shared.orientation = .portrait
    control("生成 PDF 压缩包").tap()
    XCTAssertTrue(app.otherElements["native-pdf-dialog"].waitForNonExistence(timeout: 30))
    openRecords()
    let finished = app.staticTexts["Native PDF synthetic · 已完成"]
    XCTAssertTrue(finished.waitForExistence(timeout: 120))
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "2份")).firstMatch.exists)
    capture("02-native-zip-complete")
    control("关闭导出记录").tap()
    openExport(); control("纯题目").tap(); control("生成 PDF").tap()
    XCTAssertTrue(app.otherElements["native-pdf-dialog"].waitForNonExistence(timeout: 30))
    openRecords()
    let deadline = Date().addingTimeInterval(120)
    while completedRecords() < 2 && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.5)) }
    XCTAssertEqual(completedRecords(), 2)
    XCTAssertEqual(app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "native-export-record-")).count, 2)
    capture("03-native-pdf-and-zip")
    control("关闭导出记录").tap(); app.terminate(); app.launch()
    openRecords()
    XCTAssertEqual(completedRecords(), 2)
    XCTAssertTrue(app.buttons.matching(identifier: "保存文件").firstMatch.isHittable)
    app.buttons.matching(identifier: "分享文件").firstMatch.tap()
    XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 20))
    capture("04-native-file-share")
  }
}
