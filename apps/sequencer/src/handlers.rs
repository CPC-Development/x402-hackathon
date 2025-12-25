use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use crate::{
    error::AppError,
    model::{PayInChannelRequest, PayInChannelResponse, SeedChannelRequest},
    service,
    service::AppState,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/channel/seed", post(seed_channel))
        .route("/channel/:id", get(get_channel))
        .route("/pay-in-channel", post(pay_in_channel))
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
    post,
    path = "/channel/seed",
    request_body = SeedChannelRequest,
    responses(
        (status = 200, description = "Seeded channel", body = crate::model::ChannelView),
        (status = 400, description = "Bad request")
    )
)]
pub(crate) async fn seed_channel(
    State(state): State<AppState>,
    Json(payload): Json<SeedChannelRequest>,
) -> Result<Json<crate::model::ChannelView>, AppError> {
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
        (status = 200, description = "Channel state", body = crate::model::ChannelView),
        (status = 404, description = "Not found")
    )
)]
pub(crate) async fn get_channel(
    Path(channel_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<crate::model::ChannelView>, AppError> {
    let response = service::get_channel(&state, channel_id).await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/pay-in-channel",
    request_body = PayInChannelRequest,
    responses(
        (status = 200, description = "Accepted channel update", body = PayInChannelResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Not found")
    )
)]
pub(crate) async fn pay_in_channel(
    State(state): State<AppState>,
    Json(payload): Json<PayInChannelRequest>,
) -> Result<Json<PayInChannelResponse>, AppError> {
    let response = service::pay_in_channel(&state, payload).await?;
    Ok(Json(response))
}
