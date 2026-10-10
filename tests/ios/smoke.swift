import XCTest

final class SolveFlowSmokeTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.solveflow.app")

  override func setUpWithError() throws {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app.launch()
  }

  override func tearDownWithError() throws {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "final-accessibility-tree"
    tree.lifetime = .keepAlways
    add(tree)
    capture("final-screen")
    XCUIDevice.shared.orientation = .portrait
    app.terminate()
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func control(_ label: String) -> XCUIElement {
    let types = [XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.other.rawValue]
    let element = app.descendants(matching: .any).matching(identifier: label)
      .matching(NSPredicate(format: "elementType IN %@", types)).firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: 15), "Missing control: \(label)")
    return element
  }

  private func reach(_ element: XCUIElement) {
    if element.exists && element.isHittable { return }
    let scroll = app.scrollViews.containing(.any, identifier: element.label).firstMatch
    XCTAssertTrue(scroll.waitForExistence(timeout: 5), "No scroll container for \(element.label)")
    for _ in 0..<8 {
      if element.exists && element.isHittable { return }
      if element.frame.midY < scroll.frame.minY {
        scroll.swipeDown(velocity: .slow)
      } else {
        scroll.swipeUp(velocity: .slow)
      }
    }
    XCTAssertTrue(element.isHittable, "Control \(element.label) at \(element.frame) is not reachable inside \(scroll.frame)")
  }

  func testLandscapeModalOrientation() throws {
    control("我的").tap()
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertGreaterThan(app.frame.width, app.frame.height, "Workspace did not rotate")
    control("设置").tap()
    XCTAssertGreaterThan(app.frame.width, app.frame.height, "Settings modal forced portrait orientation")
    XCTAssertTrue(app.buttons["返回"].isHittable)
    capture("landscape-modal-orientation")
    control("返回").tap()
  }

  func testOfflineDeviceFlow() throws {
    // Run only on a dedicated simulator with one synthetic photo and no user data.
    // The reserved invalid domain and dummy key are saved, never submitted.
    XCTAssertTrue(app.staticTexts["把题目拍清楚"].waitForExistence(timeout: 30))
    capture("01-cold-launch")

    control("我的").tap()
    control("设置").tap()
    XCTAssertTrue(app.staticTexts["默认考试类型"].waitForExistence(timeout: 10))
    let advanced = control("解题高级参数")
    reach(advanced)
    advanced.tap()
    XCTAssertTrue(app.textFields["解题上下文容量"].exists)
    let settingsBack = control("返回")
    XCTAssertGreaterThanOrEqual(settingsBack.frame.minY, 40, "Settings header overlaps the portrait status bar")
    settingsBack.tap()
    XCTAssertTrue(app.staticTexts["默认考试类型"].waitForNonExistence(timeout: 10), "Settings did not close")
    control("使用说明").tap()
    XCTAssertTrue(app.buttons["明白了"].waitForExistence(timeout: 10))
    control("明白了").tap()
    control("题目").tap()
    capture("02-navigation-and-settings")

    control("从相册选择").tap()
    // iOS 27 exposes photo tiles as images; the imported fixture is newest.
    let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
    XCTAssertTrue(photo.waitForExistence(timeout: 20), "Synthetic photo not present in system picker")
    photo.tap()
    if app.buttons["Add"].exists { app.buttons["Add"].tap() }
    XCTAssertTrue(app.buttons["使用这张题图"].waitForExistence(timeout: 20))
    control("使用这张题图").tap()
    let savePhoto = control("保存题目")
    reach(savePhoto)
    savePhoto.tap()
    XCTAssertTrue(app.buttons["查看题目图片"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "本题考试：")).firstMatch.waitForExistence(timeout: 15))
    capture("03-saved-synthetic-photo")

    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["查看题目图片"].waitForExistence(timeout: 30))
    control("我的").tap()
    control("查看历史题目").tap()
    XCTAssertTrue(app.staticTexts["1 条记录"].waitForExistence(timeout: 15))
    // A fallback is useful recovery, but is not successful local DOM rendering.
    XCTAssertFalse(app.staticTexts["题目摘要加载失败，仍可打开已保存的解答。"].exists)
    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
    XCTAssertTrue(app.webViews.buttons.firstMatch.waitForExistence(timeout: 20))
    capture("04-sqlite-relaunch-and-history-dom")

    control("我的").tap()
    control("设置").tap()
    control("ESAT").tap()
    let fields: [(String, String)] = [
      ("解题服务地址", "https://ios-smoke.invalid/v1"),
      ("解题供应商标识", "ios-smoke"),
      ("解题模型引用名", "offline-fixture"),
    ]
    for (label, value) in fields {
      let field = app.textFields[label]
      reach(field)
      field.tap()
      XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
      reach(field)
      XCTAssertLessThanOrEqual(field.frame.maxY, app.keyboards.firstMatch.frame.minY, "Focused field overlaps the keyboard")
      field.typeText(value)
    }
    let key = app.secureTextFields["解题API Key"]
    reach(key)
    key.tap()
    reach(key)
    XCTAssertLessThanOrEqual(key.frame.maxY, app.keyboards.firstMatch.frame.minY, "Secret field overlaps the keyboard")
    key.typeText("synthetic-ios-test-key")
    let saveSettings = control("保存设置")
    reach(saveSettings)
    saveSettings.tap()
    XCTAssertTrue(app.buttons["设置"].waitForExistence(timeout: 15))

    app.terminate()
    app.launch()
    XCTAssertTrue(app.otherElements["我的"].waitForExistence(timeout: 30))
    control("我的").tap()
    control("设置").tap()
    XCTAssertTrue(control("ESAT").isSelected)
    let address = app.textFields["解题服务地址"]
    XCTAssertTrue(address.waitForExistence(timeout: 10))
    XCTAssertEqual(address.value as? String, "https://ios-smoke.invalid/v1")
    let restoredKey = app.secureTextFields["解题API Key"]
    reach(restoredKey)
    XCTAssertFalse((restoredKey.value as? String ?? "").isEmpty, "Keychain value was not restored")
    control("返回").tap()
    capture("05-settings-and-keychain-relaunch")

    control("外观").tap()
    control("暗色").tap()
    control("完成").tap()
    capture("06-dark-appearance")
    control("外观").tap()
    control("跟随系统").tap()
    control("完成").tap()

    XCUIDevice.shared.orientation = .landscapeLeft
    control("设置").tap()
    XCTAssertGreaterThan(app.frame.width, app.frame.height, "Settings modal forced portrait orientation")
    XCTAssertTrue(app.buttons["返回"].isHittable)
    capture("07-landscape-fixed-back")
    control("返回").tap()
  }
}
