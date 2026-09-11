module.exports = {
    root: true,
    env: { browser: true, es2021: true, node: true },
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'no-empty': ['error', { allowEmptyCatch: true }],
        'no-constant-condition': ['error', { checkLoops: false }],
        eqeqeq: ['error', 'smart'],
        'prefer-const': 'warn'
    },
    ignorePatterns: ['lib/', 'node_modules/', 'devscholar_jupyter/labextension/', 'ui-tests/', '*.js']
};
