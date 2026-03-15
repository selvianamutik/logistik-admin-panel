class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://app-ten-gamma-49.vercel.app',
  );

  static const sanityProjectId = String.fromEnvironment(
    'SANITY_PROJECT_ID',
    defaultValue: 'p6do50hl',
  );

  static const sanityDataset = String.fromEnvironment(
    'SANITY_DATASET',
    defaultValue: 'production',
  );

  static const sanityApiVersion = String.fromEnvironment(
    'SANITY_API_VERSION',
    defaultValue: '2024-01-01',
  );
}
