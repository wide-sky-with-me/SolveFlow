require 'xcodeproj'
require 'fileutils'

abort 'Expected repository root and output directory' unless ARGV.length == 2
root, directory = ARGV.map { |argument| File.expand_path(argument) }
FileUtils.mkdir_p(directory)
project = Xcodeproj::Project.new(File.join(directory, 'SolveFlowSmoke.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'SolveFlowSmoke', :ios, '16.4')
source = project.main_group.new_file(File.join(root, 'tests/ios/smoke.swift'))
target.source_build_phase.add_file_reference(source)
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.solveflow.iossmoketests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'CLANG_ENABLE_MODULES' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'FRAMEWORK_SEARCH_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/Library/Frameworks'],
    'SWIFT_INCLUDE_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/usr/lib'],
    'LIBRARY_SEARCH_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/usr/lib'],
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project.path, 'SolveFlowSmoke', true)
puts project.path
