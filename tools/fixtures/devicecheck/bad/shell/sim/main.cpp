// Fixture: phoenix-sim's context properties.
void setup(QQmlContext *ctx, QObject *settings)
{
    ctx->setContextProperty(QStringLiteral("simSettings"), settings);
}
