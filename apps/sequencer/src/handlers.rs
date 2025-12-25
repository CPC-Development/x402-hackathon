use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use crate::{
    error::AppError,
    model::{ChannelView, ChannelsByOwnerResponse, PayInChannelRequest, PayInChannelResponse, SeedChannelRequest},
    service,
    service::AppState,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/channels/by-owner/:owner", get(list_channels_by_owner))
        .route("/channel/seed", post(seed_channel))
        .route("/channel/:id", get(get_channel))
        .route("/validate", post(validate_pay_in_channel))
        .route("/settle", post(settle))
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/health",
    responses((status = 200, description = "Health check", body = String))
)]
pub(crate) async fn health() -> &'static str {
    "ok"
}

#[utoipa::path(
    get,
    path = "/channels/by-owner/{owner}",
    params(
        ("owner" = String, Path, description = "Owner address (0x...)")
    ),
    responses(
        (status = 200, description = "Channels for owner (on-chain)", body = ChannelsByOwnerResponse),
        (status = 400, description = "Bad request")
    )
)]
pub(crate) async fn list_channels_by_owner(
    Path(owner): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ChannelsByOwnerResponse>, AppError> {
    let response = service::list_channels_by_owner(&state, owner).await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/channel/seed",
    request_body = SeedChannelRequest,
    responses(
        (status = 200, description = "Seeded channel", body = ChannelView),
        (status = 400, description = "Bad request")
    )
)]
pub(crate) async fn seed_channel(
    State(state): State<AppState>,
    Json(payload): Json<SeedChannelRequest>,
) -> Result<Json<ChannelView>, AppError> {
    let response = service::seed_channel(&state, payload).await?;
    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/channel/{id}",
    params(
        ("id" = String, Path, description = "Channel id (0x...)")
    ),
    responses(
        (status = 200, description = "Channel state", body = ChannelView),
        (status = 404, description = "Not found")
    )
)]
pub(crate) async fn get_channel(
    Path(channel_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ChannelView>, AppError> {
    let response = service::get_channel(&state, channel_id).await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/validate",
    request_body = PayInChannelRequest,
    responses(
        (status = 200, description = "Validated channel update (no state change)", body = PayInChannelResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Not found")
    )
)]
pub(crate) async fn validate_pay_in_channel(
    State(state): State<AppState>,
    Json(payload): Json<PayInChannelRequest>,
) -> Result<Json<PayInChannelResponse>, AppError> {
    let response = service::validate_pay_in_channel(&state, payload).await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/settle",
    request_body = PayInChannelRequest,
    responses(
        (status = 200, description = "Accepted channel update (state persisted)", body = PayInChannelResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Not found")
    )
)]
pub(crate) async fn settle(
    State(state): State<AppState>,
    Json(payload): Json<PayInChannelRequest>,
) -> Result<Json<PayInChannelResponse>, AppError> {
    let response = service::settle(&state, payload).await?;
    Ok(Json(response))
}
